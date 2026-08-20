Feature: Inventory fold and FIFO
  Scenario: Partial usage accumulates against the oldest lot
    Given a purchase of 1000 g of rice on 2026-01-01
    And a purchase of 500 g of rice on 2026-01-10
    When 300 g and then 800 g of rice are used
    Then the 2026-01-01 lot is empty
    And the 2026-01-10 lot has 400 g remaining

  Scenario: Opening shortens expiry
    Given tomato has shelf_life_days 7 and opened_shelf_life_days 2
    And a lot of 1 tomato purchased on 2026-03-01
    When the lot is opened on 2026-03-02
    Then its expiry becomes 2026-03-04

  Scenario: Freezing suspends expiry
    Given a lot of chicken expiring 2026-03-05
    When the lot is moved to the freezer on 2026-03-03
    Then its expiry is at least 2026-09-03

  Scenario: Generation mismatch forces full rebuild
    Given a snapshot built at generation 1 with cursor 40
    When events are applied with Meta generation 2
    Then the result signals "full reload required"

  Scenario: Cooking surplus creates a leftover lot
    Given "Chili" scaled to 8 servings is marked cooked for a household of 4
    Then a lot "Leftover: Chili" of 4 portions is created in the fridge
    And its expiry uses the leftover shelf-life default
