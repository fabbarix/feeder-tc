Feature: Shopping list computation
  Scenario: Shared ingredient across recipes is aggregated
    Given Monday's dinner needs 2 tomatoes and Thursday's lunch needs 3 tomatoes
    And the pantry has no tomatoes
    When the list for that week is computed
    Then it contains one line "tomato: 5 piece" listing both meals

  Scenario: Stock expiring before the cook date is not counted
    Given a lot of 4 tomatoes expiring Tuesday
    And Friday's dinner needs 3 tomatoes
    When the list is computed
    Then it contains "tomato: 3 piece"

  Scenario: Viable stock reduces the list FIFO by cook date
    Given a lot of 4 tomatoes expiring Saturday
    And Tuesday's dinner needs 3 tomatoes and Friday's dinner needs 3 tomatoes
    When the list is computed
    Then it contains "tomato: 2 piece" attributed to Friday's dinner

  Scenario: Leftover slots generate no needs
    Given Wednesday's dinner slot is "Leftover: Chili"
    When the list is computed
    Then no ingredient from the Chili recipe is added for Wednesday

  Scenario: Check-off with a bigger package creates the full lot
    Given the list contains "rice: 400 g"
    When the user checks it off entering 1000 g
    Then a purchase event for 1000 g of rice is created dated today
