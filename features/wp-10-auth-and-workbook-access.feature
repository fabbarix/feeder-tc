Feature: Authentication and workbook access
  Scenario: First sign-in creates no workbook until requested
    Given a signed-out user
    When they sign in with Google
    Then no Sheets API calls are made until they create or pick a workbook

  Scenario: Opening a shared workbook via Picker
    Given a signed-in user with no workbook configured
    When they pick spreadsheet "fam-123" in the Google Picker
    Then "fam-123" is stored in the workbook registry
    And it becomes the active workbook

  Scenario: Rate limit is retried
    Given the Sheets API responds 429 then 200 for a read
    When the transport reads range "InventoryEvents!A2:H"
    Then the read succeeds after one retry
