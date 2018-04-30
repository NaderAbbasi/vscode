/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'vs/css!./media/nextEditorGroupView';
import { EditorGroup } from 'vs/workbench/common/editor/editorStacksModel';
import { EditorInput, EditorOptions, GroupIdentifier } from 'vs/workbench/common/editor';
import { Event, Emitter } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { addClass, addClasses, Dimension, trackFocus, toggleClass, removeClass } from 'vs/base/browser/dom';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { attachProgressBarStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { editorBackground, contrastBorder, focusBorder } from 'vs/platform/theme/common/colorRegistry';
import { Themable, EDITOR_GROUP_HEADER_TABS_BORDER, EDITOR_GROUP_HEADER_TABS_BACKGROUND, EDITOR_GROUP_BACKGROUND } from 'vs/workbench/common/theme';
import { IOpenEditorResult, INextEditorGroup } from 'vs/workbench/services/editor/common/nextEditorGroupsService';
import { INextTitleAreaControl } from 'vs/workbench/browser/parts/editor2/nextTitleControl';
import { NextTabsTitleControl } from 'vs/workbench/browser/parts/editor2/nextTabsTitleControl';
import { NextEditorControl } from 'vs/workbench/browser/parts/editor2/nextEditorControl';
import { IView } from 'vs/base/browser/ui/grid/gridview';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { ProgressService } from 'vs/workbench/services/progress/browser/progressService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { localize } from 'vs/nls';

export class NextEditorGroupView extends Themable implements IView, INextEditorGroup {

	private static readonly EDITOR_TITLE_HEIGHT = 35;

	private _onDidFocus: Emitter<void> = this._register(new Emitter<void>());
	get onDidFocus(): Event<void> { return this._onDidFocus.event; }

	private _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	get onWillDispose(): Event<void> { return this._onWillDispose.event; }

	private _onDidActiveEditorChange: Emitter<BaseEditor> = this._register(new Emitter<BaseEditor>());
	get onDidActiveEditorChange(): Event<BaseEditor> { return this._onDidActiveEditorChange.event; }

	private group: EditorGroup;
	private dimension: Dimension;
	private scopedInstantiationService: IInstantiationService;

	private titleContainer: HTMLElement;
	private titleAreaControl: INextTitleAreaControl;

	private editorContainer: HTMLElement;
	private editorControl: NextEditorControl;

	private progressBar: ProgressBar;

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService
	) {
		super(themeService);

		this.group = this._register(instantiationService.createInstance(EditorGroup, ''));
		this.group.label = `Group <${this.group.id}>`;

		this.doCreate();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.group.onEditorsStructureChanged(() => this.updateContainer()));
	}

	private doCreate(): void {

		// Container
		addClasses(this.element, 'editor-group-container');

		const focusTracker = this._register(trackFocus(this.element));
		this._register(focusTracker.onDidFocus(() => {
			this._onDidFocus.fire();
		}));

		// Title container
		this.titleContainer = document.createElement('div');
		addClasses(this.titleContainer, 'title', 'tabs', 'show-file-icons');
		this.element.appendChild(this.titleContainer);

		// Progress bar
		this.progressBar = this._register(new ProgressBar(this.element));
		this._register(attachProgressBarStyler(this.progressBar, this.themeService));
		this.progressBar.hide();

		// Editor container
		this.editorContainer = document.createElement('div');
		addClass(this.editorContainer, 'editor-container');
		this.element.appendChild(this.editorContainer);

		// Update styles
		this.updateStyles();

		// Update containers
		this.updateContainer();
	}

	private updateContainer(): void {
		const empty = this.group.count === 0;

		// Empty Container: allow to focus 
		if (empty) {
			addClass(this.element, 'empty');
			this.element.tabIndex = 0;
			this.element.setAttribute('aria-label', localize('emptyEditorGroup', "Empty Editor Group"));
		}

		// Non-Empty Container: revert empty container attributes
		else {
			removeClass(this.element, 'empty');
			this.element.removeAttribute('tabIndex');
			this.element.removeAttribute('aria-label');
		}
	}

	setActive(isActive: boolean): void {

		// Update container
		toggleClass(this.element, 'active', isActive);
		toggleClass(this.element, 'inactive', !isActive);

		// Update title control
		if (this.titleAreaControl) {
			this.titleAreaControl.setActive(isActive);
		}
	}

	//#region INextEditorGroup Implementation

	get id(): GroupIdentifier {
		return this.group.id;
	}

	get activeEditor(): BaseEditor {
		return this.editorControl ? this.editorControl.activeEditor : void 0;
	}

	openEditor(input: EditorInput, options?: EditorOptions): IOpenEditorResult {

		// Update model
		this.group.openEditor(input, options);

		// Forward to title control
		this.doCreateOrGetTitleControl().openEditor(input, options);

		// Forward to editor control
		// TODO@grid handle input errors as well:
		//  - close active editor to reveal next one
		const openEditorResult = this.doCreateOrGetEditorControl().openEditor(input, options);
		openEditorResult.whenOpened.then(changed => {
			if (changed) {
				this._onDidActiveEditorChange.fire(openEditorResult.control as BaseEditor);
			}
		}, () => void 0 /* TODO@grid handle errors here as open fail event? but do not re-emit to outside */);

		return openEditorResult;
	}

	private doCreateOrGetScopedInstantiationService(): IInstantiationService {
		if (!this.scopedInstantiationService) {
			this.scopedInstantiationService = this.instantiationService.createChild(new ServiceCollection(
				[IContextKeyService, this._register(this.contextKeyService.createScoped(this.element))],
				[IProgressService, new ProgressService(this.progressBar)]
			));
		}

		return this.scopedInstantiationService;
	}

	private doCreateOrGetTitleControl(): INextTitleAreaControl {
		if (!this.titleAreaControl) {
			this.titleAreaControl = this._register(this.doCreateOrGetScopedInstantiationService().createInstance(NextTabsTitleControl, this.titleContainer, this.group));
			this.doLayoutTitleControl();
		}

		return this.titleAreaControl;
	}

	private doCreateOrGetEditorControl(): NextEditorControl {
		if (!this.editorControl) {
			this.editorControl = this._register(this.doCreateOrGetScopedInstantiationService().createInstance(NextEditorControl, this.editorContainer, this.group));
			this.doLayoutEditorControl();
		}

		return this.editorControl;
	}

	focusActiveEditor(): void {
		const activeEditor = this.activeEditor;
		if (activeEditor) {
			activeEditor.focus();
		}
	}

	pinEditor(input?: EditorInput): void {
		if (!input) {
			input = this.activeEditor ? this.activeEditor.input : void 0;
		}

		if (input && !this.group.isPinned(input)) {

			// Update model
			this.group.pin(input);

			// Forward to title control
			if (this.titleAreaControl) {
				this.titleAreaControl.pinEditor(input);
			}
		}
	}

	//#endregion

	//#region Themable Implementation

	protected updateStyles(): void {

		// Container
		this.element.style.backgroundColor = this.getColor(EDITOR_GROUP_BACKGROUND);
		this.element.style.outlineColor = this.getColor(focusBorder);

		// Title control
		const borderColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BORDER) || this.getColor(contrastBorder);
		this.titleContainer.style.backgroundColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BACKGROUND);
		this.titleContainer.style.borderBottomWidth = borderColor ? '1px' : null;
		this.titleContainer.style.borderBottomStyle = borderColor ? 'solid' : null;
		this.titleContainer.style.borderBottomColor = borderColor;

		// Editor container
		this.editorContainer.style.backgroundColor = this.getColor(editorBackground);
	}

	//#endregion

	//#region IView implementation

	readonly element: HTMLElement = document.createElement('div');

	readonly minimumWidth = 170;
	readonly minimumHeight = 70;
	readonly maximumWidth = Number.POSITIVE_INFINITY;
	readonly maximumHeight = Number.POSITIVE_INFINITY;

	get onDidChange() { return Event.None; }

	layout(width: number, height: number): void {
		this.dimension = new Dimension(width, height);

		// Forward to controls
		this.doLayoutTitleControl();
		this.doLayoutEditorControl();
	}

	private doLayoutTitleControl(): void {
		if (this.titleAreaControl) {
			this.titleAreaControl.layout(new Dimension(this.dimension.width, NextEditorGroupView.EDITOR_TITLE_HEIGHT));
		}
	}

	private doLayoutEditorControl(): void {
		if (this.editorControl) {
			this.editorControl.layout(new Dimension(this.dimension.width, this.dimension.height - NextEditorGroupView.EDITOR_TITLE_HEIGHT));
		}
	}

	//#endregion

	shutdown(): void {
		if (this.editorControl) {
			this.editorControl.shutdown();
		}
	}

	dispose(): void {
		this._onWillDispose.fire();

		super.dispose();
	}
}