Feature: WP-01 scaffold harness
  A trivial scenario proving the Vitest + @amiceli/vitest-cucumber harness
  runs a .feature file end to end. Later work packages replace this with
  real domain scenarios; keep it around as the harness smoke test.

  Scenario: A pure function step passes
    Given two numbers 2 and 3
    When they are added
    Then the result is 5
