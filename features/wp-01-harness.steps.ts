import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";

const feature = await loadFeature("./wp-01-harness.feature");

describeFeature(feature, ({ Scenario }) => {
  Scenario("A pure function step passes", ({ Given, When, Then }) => {
    let a = 0;
    let b = 0;
    let result = 0;

    Given("two numbers 2 and 3", () => {
      a = 2;
      b = 3;
    });

    When("they are added", () => {
      result = a + b;
    });

    Then("the result is 5", () => {
      expect(result).toBe(5);
    });
  });
});
