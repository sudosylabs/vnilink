// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import type { ServiceKind } from '../../engine/common/engine.js';

/** A computer connected to this one, as the connected-computers window lists it. */
export interface IndicatorComputer {
	/** The hosted session, which Disconnect ends. */
	readonly id: string;
	readonly name: string;
	/** What it is using now. */
	readonly services: readonly ServiceKind[];
	/** When this computer first saw it using something, in milliseconds since the epoch. */
	readonly since: number;
}

/** What the connected-computers window shows; sent again whenever it changes. */
export interface IndicatorContent {
	readonly computers: readonly IndicatorComputer[];
}

/** The window's channels; its preload exposes only these. */
export const INDICATOR_SHOW_CHANNEL = 'vnilink:indicator-show';

export const INDICATOR_DISCONNECT_CHANNEL = 'vnilink:indicator-disconnect';
/** Whether the pointer or keyboard focus is in the window, which holds it open. */
export const INDICATOR_ATTENTION_CHANNEL = 'vnilink:indicator-attention';

export const INDICATOR_MATERIAL_CHANNEL = 'vnilink:indicator-material';

/** The page the window loads. */
export const INDICATOR_URL = 'vnilink://app/indicator.html';

/** At most this many computers are listed; a host serves only a few at once. */
export const INDICATOR_MAX_COMPUTERS = 16;

const serviceKinds: readonly unknown[] = ['Desktop', 'Files', 'Terminal', 'Camera', 'SystemAudio', 'Microphone', 'System', 'ScreenSnapshot'] satisfies readonly ServiceKind[];

/** A session id as the engine gives it: decimal digits. */
export function isIndicatorSessionId(value: unknown): value is string {
	return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

function isComputer(value: unknown): value is IndicatorComputer {
	if (typeof value !== 'object' || value === null || Object.keys(value).length !== 4) {
		return false;
	}
	const name: unknown = Reflect.get(value, 'name');
	const services: unknown = Reflect.get(value, 'services');
	return isIndicatorSessionId(Reflect.get(value, 'id'))
		&& typeof name === 'string' && name.length <= 256
		&& Array.isArray(services) && services.length <= serviceKinds.length && services.every(kind => serviceKinds.includes(kind))
		&& Number.isSafeInteger(Reflect.get(value, 'since'));
}

export function isIndicatorContent(value: unknown): value is IndicatorContent {
	if (typeof value !== 'object' || value === null || Object.keys(value).length !== 1) {
		return false;
	}
	const computers: unknown = Reflect.get(value, 'computers');
	return Array.isArray(computers) && computers.length <= INDICATOR_MAX_COMPUTERS && computers.every(isComputer);
}
