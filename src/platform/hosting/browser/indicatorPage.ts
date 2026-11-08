// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import '../../theme/browser/media/colors.css';
import './media/indicator.css';
import { $, addDisposableListener, append, clearNode, EventType } from '../../../base/browser/dom.js';
import { Button } from '../../../base/browser/ui/button/button.js';
import { renderIcon } from '../../../base/browser/ui/icon/icon.js';
import { Icons } from '../../../base/common/icons.js';
import { Disposable, DisposableStore, toDisposable } from '../../../base/common/lifecycle.js';
import { defaultButtonStyles } from '../../theme/browser/defaultStyles.js';
import type { WindowBackgroundMaterial } from '../../window/common/windowMaterial.js';
import type { IndicatorComputer, IndicatorContent } from '../common/indicator.js';
import { indicatorAnnouncement, indicatorDisconnectLabel, indicatorDisconnectName, indicatorDuration, indicatorServices, indicatorTitle } from '../common/indicatorText.js';

/** The connected-computers window's preload API. */
export interface IndicatorBridge {
	onShow(listener: (content: IndicatorContent) => void): void;
	onMaterial(listener: (material: WindowBackgroundMaterial) => void): void;
	disconnect(sessionId: string): void;
	/** Whether the pointer or keyboard focus is in the window. */
	attention(held: boolean): void;
}

/** How often the connected durations are written again. */
const durationRefresh = 30_000;

/**
 * Lists the computers connected to this one, what each is using and for how
 * long, each with a Disconnect button. Who connected is announced politely,
 * once. The window closes itself; holding the pointer or focus in it keeps
 * it open.
 */
export class IndicatorPage extends Disposable {
	private readonly rows = this._register(new DisposableStore());
	private readonly announced = new Set<string>();
	private readonly heading: HTMLElement;
	private readonly list: HTMLElement;
	private readonly spoken: HTMLElement;
	private readonly durations = new Map<HTMLElement, number>();
	private pointer = false;
	private focus = false;
	private held = false;

	constructor(
		private readonly container: HTMLElement,
		private readonly bridge: IndicatorBridge,
		private readonly now: () => number = Date.now,
	) {
		super();
		const panel = append(container, $('.indicator', { role: 'region', 'aria-labelledby': 'indicator-title' }));
		const header = append(panel, $('.indicator-header'));
		append(append(header, $('.indicator-icon', { 'aria-hidden': 'true' })), renderIcon(Icons.security));
		this.heading = append(header, $('h1#indicator-title'));
		this.list = append(panel, $('ul.indicator-list'));
		this.spoken = append(panel, $('p.indicator-spoken', { 'aria-live': 'polite' }));
		bridge.onMaterial(material => {
			container.ownerDocument.documentElement.dataset.windowMaterial = material;
		});
		bridge.onShow(content => {
			this.render(content);
		});
		const document = container.ownerDocument;
		const watch = (target: EventTarget, enter: string, leave: string, set: (inside: boolean) => void): void => {
			this._register(addDisposableListener(target, enter, () => {
				set(true);
			}));
			this._register(addDisposableListener(target, leave, () => {
				set(false);
			}));
		};
		watch(document.documentElement, EventType.MOUSE_ENTER, EventType.MOUSE_LEAVE, inside => {
			this.pointer = inside;
			this.sendAttention();
		});
		watch(document, EventType.FOCUS_IN, EventType.FOCUS_OUT, inside => {
			this.focus = inside;
			this.sendAttention();
		});
		const timer = setInterval(() => {
			this.writeDurations();
		}, durationRefresh);
		this._register(toDisposable(() => {
			clearInterval(timer);
		}));
	}

	/** Tells main once each time the pointer or focus arrives or both have left. */
	private sendAttention(): void {
		const held = this.pointer || this.focus;
		if (held !== this.held) {
			this.held = held;
			this.bridge.attention(held);
		}
	}

	private render(content: IndicatorContent): void {
		this.heading.textContent = indicatorTitle(content.computers.length);
		this.rows.clear();
		this.durations.clear();
		clearNode(this.list);
		for (const computer of content.computers) {
			this.renderComputer(computer);
		}
		this.writeDurations();
		const arrived = content.computers.filter(computer => !this.announced.has(computer.id));
		for (const computer of arrived) {
			this.announced.add(computer.id);
		}
		if (arrived.length) {
			this.spoken.textContent = arrived.map(computer => indicatorAnnouncement(computer.name)).join(' ');
		}
	}

	private renderComputer(computer: IndicatorComputer): void {
		const row = append(this.list, $('li.indicator-computer'));
		const text = append(row, $('.indicator-computer-text'));
		append(text, $('.indicator-computer-name')).textContent = computer.name;
		append(text, $('.indicator-computer-services')).textContent = indicatorServices(computer.services);
		this.durations.set(append(text, $('.indicator-computer-since')), computer.since);
		const ariaLabel = indicatorDisconnectName(computer.name);
		const disconnect = this.rows.add(new Button(row, { ...defaultButtonStyles, secondary: true, title: false, ariaLabel }));
		disconnect.label = indicatorDisconnectLabel();
		this.rows.add(disconnect.onDidClick(() => {
			disconnect.enabled = false;
			this.bridge.disconnect(computer.id);
		}));
	}

	private writeDurations(): void {
		const now = this.now();
		for (const [element, since] of this.durations) {
			element.textContent = indicatorDuration(since, now);
		}
	}
}
