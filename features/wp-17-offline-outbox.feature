Feature: Offline outbox

  Scenario: Writes queue while offline and flush on reconnect
    Given the client is offline
    When the user checks off "rice: 400 g" and logs usage of 2 tomatoes
    Then 2 events sit in the outbox and the local snapshot reflects both
    When connectivity returns
    Then both events are appended to InventoryEvents in order
    And the outbox is empty

  Scenario: Flush retry does not duplicate events
    Given an outbox flush where the first append times out after the server applied it
    When the flush retries
    Then InventoryEvents contains the event exactly once

  Scenario: Incremental sync uses the cursor
    Given a snapshot with cursor 120 and matching generation
    When sync runs and the sheet has 125 rows
    Then only rows 121-125 are fetched and folded
