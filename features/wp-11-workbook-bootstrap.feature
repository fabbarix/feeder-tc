Feature: Workbook bootstrap
  Scenario: Creating a fresh workbook
    Given a signed-in user with no workbook
    When they choose "Create new meal planner"
    Then a spreadsheet is created with sheets
      | Meta | Settings | Ingredients | Recipes | RecipeIngredients | RecipeSteps | PlanSlots | InventoryEvents | ShoppingItems |
    And Meta contains schema_version 1 and generation 1

  Scenario: Malformed row does not break loading
    Given the Ingredients sheet contains a row with unit "banana-units"
    When the catalog is loaded
    Then the row is excluded and a data warning lists row number and reason
