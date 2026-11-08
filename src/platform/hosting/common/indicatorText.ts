// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import type { ServiceKind } from '../../engine/common/engine.js';
import * as nls from '../../../nls.js';

/** The window's heading. */
export function indicatorTitle(count: number): string {
	return count === 1
		? nls.localize('indicator.titleOne', 'A computer is connected to this one')
		: nls.localize('indicator.titleMany', '{0} computers are connected to this one', count);
}

/** What a connected computer is using, in the person's words. */
export function indicatorServiceLabel(kind: ServiceKind): string {
	switch (kind) {
		case 'Desktop': return nls.localize('indicator.desktop', 'Screen');
		case 'ScreenSnapshot': return nls.localize('indicator.screenshot', 'Screenshot');
		case 'Files': return nls.localize('indicator.files', 'Files');
		case 'Terminal': return nls.localize('indicator.terminal', 'Terminal');
		case 'Camera': return nls.localize('indicator.camera', 'Camera');
		case 'Microphone': return nls.localize('indicator.microphone', 'Microphone');
		case 'SystemAudio': return nls.localize('indicator.systemAudio', 'System sound');
		case 'System': return nls.localize('indicator.system', 'Restart and shut down');
	}
}

/** One line listing what a computer is using. */
export function indicatorServices(services: readonly ServiceKind[]): string {
	return services.map(indicatorServiceLabel).join(' · ');
}

/** How long a computer has been connected, to the minute. */
export function indicatorDuration(since: number, now: number): string {
	const minutes = Math.max(0, Math.floor((now - since) / 60_000));
	if (minutes < 1) {
		return nls.localize('indicator.justNow', 'Connected just now');
	}
	if (minutes < 60) {
		return nls.localize('indicator.minutes', 'Connected for {0} min', minutes);
	}
	return nls.localize('indicator.hours', 'Connected for {0} h {1} min', Math.floor(minutes / 60), minutes % 60);
}

/** The button that ends one computer's connection. */
export function indicatorDisconnectLabel(): string {
	return nls.localize('indicator.disconnect', 'Disconnect');
}

/** The Disconnect button's accessible name, which says whose connection it ends. */
export function indicatorDisconnectName(name: string): string {
	return nls.localize('indicator.disconnectName', 'Disconnect {0}', name);
}

/** Spoken when a computer starts using this one. */
export function indicatorAnnouncement(name: string): string {
	return nls.localize('indicator.connected', '{0} is connected to this computer', name);
}
