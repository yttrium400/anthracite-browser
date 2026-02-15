"""Test autocomplete/combobox field detection and value readback.

Tests cover:
- Value mismatch detection when JS rewrites input value
- Combobox field detection (role=combobox + aria-autocomplete)
- Datalist field detection (input with list attribute)
- No false positives on plain inputs
- Sensitive data skips value verification
"""

import asyncio

import pytest
from pytest_httpserver import HTTPServer

from browser_use.agent.views import ActionResult
from browser_use.browser import BrowserSession
from browser_use.browser.profile import BrowserProfile
from browser_use.tools.service import Tools


@pytest.fixture(scope='session')
def http_server():
	"""Create and provide a test HTTP server with autocomplete test pages."""
	server = HTTPServer()
	server.start()

	# Page 1: Input with JS that rewrites value on change (simulates autocomplete replacing text)
	server.expect_request('/autocomplete-rewrite').respond_with_data(
		"""
		<!DOCTYPE html>
		<html>
		<head><title>Autocomplete Rewrite Test</title></head>
		<body>
			<input id="search" type="text" />
			<script>
				const input = document.getElementById('search');
				input.addEventListener('change', function() {
					// Simulate autocomplete rewriting the value
					this.value = 'REWRITTEN_' + this.value;
				});
			</script>
		</body>
		</html>
		""",
		content_type='text/html',
	)

	# Page 2: Input with role=combobox + aria-autocomplete=list + aria-controls + listbox
	server.expect_request('/combobox-field').respond_with_data(
		"""
		<!DOCTYPE html>
		<html>
		<head><title>Combobox Field Test</title></head>
		<body>
			<div>
				<input id="combo" type="text" role="combobox"
					aria-autocomplete="list" aria-controls="suggestions-list"
					aria-expanded="false" />
				<ul id="suggestions-list" role="listbox" style="display:none;">
					<li role="option">Option A</li>
					<li role="option">Option B</li>
				</ul>
			</div>
		</body>
		</html>
		""",
		content_type='text/html',
	)

	# Page 3: Input with list attribute pointing to a datalist
	server.expect_request('/datalist-field').respond_with_data(
		"""
		<!DOCTYPE html>
		<html>
		<head><title>Datalist Field Test</title></head>
		<body>
			<input id="city" type="text" list="suggestions" />
			<datalist id="suggestions">
				<option value="New York">
				<option value="Los Angeles">
				<option value="Chicago">
			</datalist>
		</body>
		</html>
		""",
		content_type='text/html',
	)

	# Page 4: Plain input with no autocomplete attributes
	server.expect_request('/normal-input').respond_with_data(
		"""
		<!DOCTYPE html>
		<html>
		<head><title>Normal Input Test</title></head>
		<body>
			<input id="plain" type="text" placeholder="Just a normal input" />
		</body>
		</html>
		""",
		content_type='text/html',
	)

	yield server
	server.stop()


@pytest.fixture(scope='session')
def base_url(http_server):
	"""Return the base URL for the test HTTP server."""
	return f'http://{http_server.host}:{http_server.port}'


@pytest.fixture(scope='module')
async def browser_session():
	"""Create and provide a Browser instance for testing."""
	browser_session = BrowserSession(
		browser_profile=BrowserProfile(
			headless=True,
			user_data_dir=None,
			keep_alive=True,
			chromium_sandbox=False,
		)
	)
	await browser_session.start()
	yield browser_session
	await browser_session.kill()


@pytest.fixture(scope='function')
def tools():
	"""Create and provide a Tools instance."""
	return Tools()


class TestAutocompleteInteraction:
	"""Test autocomplete/combobox detection and value readback."""

	async def test_value_mismatch_detected(self, tools: Tools, browser_session: BrowserSession, base_url: str):
		"""Type into a field whose JS rewrites the value on change. Assert the ActionResult notes the mismatch."""
		await tools.navigate(url=f'{base_url}/autocomplete-rewrite', new_tab=False, browser_session=browser_session)
		await asyncio.sleep(0.3)
		await browser_session.get_browser_state_summary()

		input_index = await browser_session.get_index_by_id('search')
		assert input_index is not None, 'Could not find search input'

		result = await tools.input(index=input_index, text='hello', browser_session=browser_session)

		assert isinstance(result, ActionResult)
		assert result.extracted_content is not None
		assert 'differs from typed text' in result.extracted_content, (
			f'Expected mismatch note in extracted_content, got: {result.extracted_content}'
		)

	async def test_combobox_field_detected(self, tools: Tools, browser_session: BrowserSession, base_url: str):
		"""Type into a combobox field. Assert the ActionResult includes autocomplete guidance."""
		await tools.navigate(url=f'{base_url}/combobox-field', new_tab=False, browser_session=browser_session)
		await asyncio.sleep(0.3)
		await browser_session.get_browser_state_summary()

		combo_index = await browser_session.get_index_by_id('combo')
		assert combo_index is not None, 'Could not find combobox input'

		result = await tools.input(index=combo_index, text='test', browser_session=browser_session)

		assert isinstance(result, ActionResult)
		assert result.extracted_content is not None
		assert 'autocomplete field' in result.extracted_content, (
			f'Expected autocomplete guidance in extracted_content, got: {result.extracted_content}'
		)

	async def test_datalist_field_detected(self, tools: Tools, browser_session: BrowserSession, base_url: str):
		"""Type into a datalist-backed field. Assert the ActionResult includes autocomplete guidance."""
		await tools.navigate(url=f'{base_url}/datalist-field', new_tab=False, browser_session=browser_session)
		await asyncio.sleep(0.3)
		await browser_session.get_browser_state_summary()

		city_index = await browser_session.get_index_by_id('city')
		assert city_index is not None, 'Could not find datalist input'

		result = await tools.input(index=city_index, text='New', browser_session=browser_session)

		assert isinstance(result, ActionResult)
		assert result.extracted_content is not None
		assert 'autocomplete field' in result.extracted_content, (
			f'Expected autocomplete guidance in extracted_content, got: {result.extracted_content}'
		)

	async def test_normal_input_no_false_positive(self, tools: Tools, browser_session: BrowserSession, base_url: str):
		"""Type into a plain input. Assert the ActionResult does NOT contain autocomplete guidance."""
		await tools.navigate(url=f'{base_url}/normal-input', new_tab=False, browser_session=browser_session)
		await asyncio.sleep(0.3)
		await browser_session.get_browser_state_summary()

		plain_index = await browser_session.get_index_by_id('plain')
		assert plain_index is not None, 'Could not find plain input'

		result = await tools.input(index=plain_index, text='hello', browser_session=browser_session)

		assert isinstance(result, ActionResult)
		assert result.extracted_content is not None
		assert 'autocomplete field' not in result.extracted_content, (
			f'Got false positive autocomplete guidance on plain input: {result.extracted_content}'
		)

	async def test_sensitive_data_skips_value_verification(self, tools: Tools, browser_session: BrowserSession, base_url: str):
		"""Type sensitive data into the rewrite field. Assert no 'differs from typed text' note appears."""
		await tools.navigate(url=f'{base_url}/autocomplete-rewrite', new_tab=False, browser_session=browser_session)
		await asyncio.sleep(0.3)
		await browser_session.get_browser_state_summary()

		input_index = await browser_session.get_index_by_id('search')
		assert input_index is not None, 'Could not find search input'

		# Use tools.act() with sensitive_data to trigger the sensitive code path
		result = await tools.input(
			index=input_index,
			text='secret123',
			browser_session=browser_session,
			sensitive_data={'password': 'secret123'},
		)

		assert isinstance(result, ActionResult)
		assert result.extracted_content is not None
		assert 'differs from typed text' not in result.extracted_content, (
			f'Sensitive data should not show value mismatch: {result.extracted_content}'
		)
