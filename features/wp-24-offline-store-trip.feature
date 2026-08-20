Feature: Offline store trip

  Scenario: Checking off while offline
    Given the app is installed and the shopping list is loaded
    And the network goes offline
    When the user checks off "rice: 400 g"
    Then the item shows as bought
    And the sync banner reports 1 change waiting
    When the network returns
    Then the purchase event reaches the workbook and the banner clears
