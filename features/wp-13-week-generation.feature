Feature: Week generation
  Scenario: Staples are guaranteed before random fill
    Given 2 staple dinner recipes and 10 in-rotation dinner recipes
    When a week with 7 dinner slots is generated
    Then both staples appear exactly once

  Scenario: More staples than slots round-robins across weeks
    Given 9 staple dinner recipes and a 7-dinner week
    When two consecutive weeks are generated
    Then every staple appears at least once across the two weeks
    And no staple appears twice before all have appeared once

  Scenario: Recently cooked recipes are excluded
    Given "Carbonara" was cooked 1 week ago and the exclusion window is 3 weeks
    When a week is generated
    Then "Carbonara" is not selected for any slot

  Scenario: Expiring pantry lots boost matching recipes
    Given a lot of chicken expires this week
    And "Roast chicken" is in rotation and uses chicken
    When 1000 weeks are generated with different seeds
    Then "Roast chicken" is selected significantly more often than baseline

  Scenario: Retired recipes never appear
    Given "Liver stew" has status retired
    When a week is generated
    Then "Liver stew" is not selected
