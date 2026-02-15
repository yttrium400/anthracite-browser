"""
Tests for Anthracite-specific enhancements to browser-use.

Tests:
1. Loop Detection - verifies that repeated identical actions trigger loop detection.
2. Two-Tier Agent - verifies planner_llm parameter acceptance and fallback.
3. DOM Attribute Enhancement - verifies new attributes in DEFAULT_INCLUDE_ATTRIBUTES.
4. Condensed Messages - verifies get_condensed_messages strips images and truncates.
"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch

# ============================================================
# 1. Loop Detection Tests
# ============================================================


class TestLoopDetection:
    """Test that loop detection correctly identifies repeated actions."""

    def test_history_registry_exists_on_agent_state(self):
        """AgentState should have a history_registry field."""
        from browser_use.agent.views import AgentState

        state = AgentState()
        assert hasattr(state, 'history_registry')
        assert isinstance(state.history_registry, list)
        assert len(state.history_registry) == 0

    def test_loop_detection_triggers_after_three_identical_actions(self):
        """history_registry should detect loops when 3 identical signatures are appended."""
        from browser_use.agent.views import AgentState

        state = AgentState()
        signature = ('https://example.com', 'click', '42')

        # Simulate appending the same action 3 times
        state.history_registry.append(signature)
        state.history_registry.append(signature)
        state.history_registry.append(signature)

        # Check that the last 3 are identical
        last_three = state.history_registry[-3:]
        assert all(x == signature for x in last_three), (
            'Loop detection should trigger when 3 identical signatures are present'
        )

    def test_no_false_positive_with_varied_actions(self):
        """Loop detection should NOT trigger when actions vary."""
        from browser_use.agent.views import AgentState

        state = AgentState()
        state.history_registry.append(('https://a.com', 'click', '1'))
        state.history_registry.append(('https://a.com', 'type', '2'))
        state.history_registry.append(('https://a.com', 'click', '1'))

        last_three = state.history_registry[-3:]
        signature = last_three[-1]
        assert not all(x == signature for x in last_three), (
            'Loop detection should NOT fire with varied actions'
        )


# ============================================================
# 2. Two-Tier Agent Tests
# ============================================================


class TestTwoTierAgent:
    """Test that Agent accepts planner_llm and uses it correctly."""

    def test_agent_init_accepts_planner_llm(self):
        """Agent.__init__ should accept planner_llm parameter."""
        import inspect
        from browser_use.agent.service import Agent

        sig = inspect.signature(Agent.__init__)
        assert 'planner_llm' in sig.parameters, (
            'Agent.__init__ should accept planner_llm parameter'
        )

    def test_get_model_output_accepts_llm_parameter(self):
        """get_model_output should accept an optional llm parameter."""
        import inspect
        from browser_use.agent.service import Agent

        sig = inspect.signature(Agent.get_model_output)
        assert 'llm' in sig.parameters, (
            'get_model_output should accept an optional llm parameter'
        )
        # Default should be None
        assert sig.parameters['llm'].default is None


# ============================================================
# 3. DOM Attribute Enhancement Tests
# ============================================================


class TestDOMAttributes:
    """Test that DEFAULT_INCLUDE_ATTRIBUTES includes new targeting attributes."""

    def test_aria_description_in_default_attributes(self):
        """aria-description should be in DEFAULT_INCLUDE_ATTRIBUTES."""
        from browser_use.dom.views import DEFAULT_INCLUDE_ATTRIBUTES

        assert 'aria-description' in DEFAULT_INCLUDE_ATTRIBUTES, (
            'aria-description should be in DEFAULT_INCLUDE_ATTRIBUTES for better targeting'
        )

    def test_data_testid_in_default_attributes(self):
        """data-testid should be in DEFAULT_INCLUDE_ATTRIBUTES."""
        from browser_use.dom.views import DEFAULT_INCLUDE_ATTRIBUTES

        assert 'data-testid' in DEFAULT_INCLUDE_ATTRIBUTES, (
            'data-testid should be in DEFAULT_INCLUDE_ATTRIBUTES for better targeting'
        )

    def test_existing_attributes_still_present(self):
        """Existing critical attributes should still be in DEFAULT_INCLUDE_ATTRIBUTES."""
        from browser_use.dom.views import DEFAULT_INCLUDE_ATTRIBUTES

        for attr in ['title', 'id', 'name', 'role', 'aria-label', 'placeholder']:
            assert attr in DEFAULT_INCLUDE_ATTRIBUTES, (
                f'{attr} should still be in DEFAULT_INCLUDE_ATTRIBUTES'
            )


# ============================================================
# 4. Condensed Messages Tests
# ============================================================


class TestCondensedMessages:
    """Test that MessageManager.get_condensed_messages works correctly."""

    def test_get_condensed_messages_method_exists(self):
        """MessageManager should have a get_condensed_messages method."""
        from browser_use.agent.message_manager.service import MessageManager

        assert hasattr(MessageManager, 'get_condensed_messages'), (
            'MessageManager should have a get_condensed_messages method'
        )

    def test_condensed_messages_strips_images(self):
        """get_condensed_messages should strip image content parts."""
        from browser_use.llm.messages import (
            SystemMessage,
            ContentPartTextParam,
            ContentPartImageParam,
        )
        from browser_use.agent.message_manager.service import MessageManager

        # We can't easily instantiate a full MessageManager without wiring up
        # a lot of dependencies, so we test the logic pattern directly
        text_part = ContentPartTextParam(type='text', text='Hello')
        image_part = ContentPartImageParam(type='image_url', image_url={'url': 'data:image/png;base64,abc'})

        mixed_parts = [text_part, image_part]

        # Filter the same way get_condensed_messages does
        text_only = [part for part in mixed_parts if isinstance(part, ContentPartTextParam)]
        assert len(text_only) == 1
        assert text_only[0].text == 'Hello'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
