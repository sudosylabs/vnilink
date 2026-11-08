// ---------------------------------------------------------------------------------------------
// Copyright (c) 2026 Sudosy Labs. All rights reserved.
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE in the project root for license information.
// SPDX-License-Identifier: AGPL-3.0-only
// ---------------------------------------------------------------------------------------------

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { INDICATOR_MAX_COMPUTERS, isIndicatorContent } from '../../common/indicator.js';
import { indicatorDuration } from '../../common/indicatorText.js';

const computer = { id: '7', name: 'Work laptop', services: ['Desktop', 'Files'], since: 1_000 };

suite('connected-computers window contract', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('accepts the computers main sends', () => {
		assert.strictEqual(isIndicatorContent({ computers: [computer] }), true);
		assert.strictEqual(isIndicatorContent({ computers: [] }), true);
	});
	const refused: readonly (readonly [string, unknown])[] = [
		['a session id that is not the engine\'s', { computers: [{ ...computer, id: '../1' }] }],
		['a service the engine does not have', { computers: [{ ...computer, services: ['Keyboard'] }] }],
		['a name longer than a device name', { computers: [{ ...computer, name: 'x'.repeat(257) }] }],
		['a field it does not know', { computers: [{ ...computer, extra: true }] }],
		['more computers than it lists', { computers: Array.from({ length: INDICATOR_MAX_COMPUTERS + 1 }, () => computer) }],
	];
	for (const [name, content] of refused) {
		test(`refuses ${name}`, () => {
			assert.strictEqual(isIndicatorContent(content), false);
		});
	}
	test('says how long a computer has been connected, to the minute', () => {
		assert.deepStrictEqual([0, 59_999, 60_000, 3_660_000].map(elapsed => indicatorDuration(0, elapsed)), ['Connected just now', 'Connected just now', 'Connected for 1 min', 'Connected for 1 h 1 min']);
	});
});
