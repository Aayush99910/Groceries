"""Autocomplete hints for day one.

These are NOT inserted into the database -- nothing pretends she bought
something she didn't. They just seed the name suggestions so her very first
entry can be a tap instead of typing. Once she has real history, her own items
rank above these.
"""

COMMON_ITEMS: list[str] = [
    # produce
    "Bananas", "Apples", "Spinach", "Tomatoes", "Onions", "Garlic", "Potatoes",
    "Carrots", "Bell peppers", "Lemons", "Limes", "Avocados", "Cucumber",
    "Broccoli", "Strawberries", "Blueberries", "Grapes", "Mushrooms", "Lettuce",
    "Ginger", "Cilantro", "Green onions", "Sweet potatoes", "Oranges",
    # dairy & eggs
    "Milk", "Eggs", "Butter", "Greek yoghurt", "Cheddar cheese", "Mozzarella",
    "Cream cheese", "Sour cream", "Paneer", "Heavy cream", "Parmesan",
    # meat & fish
    "Chicken breast", "Chicken thighs", "Ground beef", "Ground turkey",
    "Salmon", "Shrimp", "Bacon", "Sausage", "Steak", "Tofu",
    # bakery
    "Bread", "Tortillas", "Bagels", "Buns", "Naan", "Pita",
    # pantry
    "Rice", "Pasta", "Olive oil", "Pasta sauce", "Black beans", "Chickpeas",
    "Peanut butter", "Oats", "Cereal", "Coffee", "Tea", "Honey", "Lentils",
    "Flour", "Sugar", "Salt", "Soy sauce", "Canned tomatoes", "Coconut milk",
    "Vinegar", "Hot sauce", "Ketchup", "Mayonnaise", "Mustard", "Ramen",
    # frozen
    "Frozen peas", "Frozen berries", "Ice cream", "Frozen pizza", "Frozen fries",
    # snacks & drinks
    "Dark chocolate", "Tortilla chips", "Almonds", "Cashews", "Popcorn",
    "Granola bars", "Cookies", "Crackers", "Hummus",
    "Orange juice", "Sparkling water", "Soda", "Beer", "Wine",
    # household
    "Paper towels", "Dish soap", "Toilet paper", "Laundry detergent",
    "Toothpaste", "Shampoo", "Trash bags", "Sponges", "Hand soap",
]

# Rough guess at a category from the name, so she doesn't have to pick one.
# Wrong guesses are harmless -- category is only used to group the list.
CATEGORY_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("produce", ("banana", "apple", "spinach", "tomato", "onion", "garlic",
                 "potato", "carrot", "pepper", "lemon", "lime", "avocado",
                 "cucumber", "broccoli", "berry", "berries", "grape",
                 "mushroom", "lettuce", "ginger", "cilantro", "orange",
                 "lettuce", "kale", "celery", "fruit", "salad")),
    ("dairy", ("milk", "egg", "butter", "yoghurt", "yogurt", "cheese",
               "cream", "paneer", "mozzarella", "parmesan")),
    ("meat", ("chicken", "beef", "turkey", "salmon", "shrimp", "bacon",
              "sausage", "steak", "tofu", "fish", "pork", "lamb", "mince")),
    ("bakery", ("bread", "tortilla", "bagel", "bun", "naan", "pita",
                "croissant", "muffin")),
    ("frozen", ("frozen", "ice cream", "popsicle")),
    ("snacks", ("chocolate", "chip", "almond", "cashew", "popcorn", "granola",
                "cookie", "cracker", "hummus", "candy", "nuts")),
    ("drinks", ("juice", "water", "soda", "beer", "wine", "coffee", "tea",
                "kombucha", "smoothie")),
    ("household", ("paper towel", "soap", "toilet", "detergent", "toothpaste",
                   "shampoo", "trash", "sponge", "cleaner", "wipes",
                   "conditioner", "deodorant")),
    ("pantry", ("rice", "pasta", "oil", "sauce", "bean", "chickpea", "oat",
                "cereal", "honey", "lentil", "flour", "sugar", "salt",
                "vinegar", "ketchup", "mayo", "mustard", "ramen", "canned",
                "spice", "noodle", "broth", "peanut butter", "jam")),
]

CATEGORY_ORDER = [
    "produce", "dairy", "meat", "bakery", "pantry", "frozen",
    "snacks", "drinks", "household", "other",
]

# Plain text: the UI draws real icons, so labels don't carry emoji.
CATEGORY_LABELS = {
    "produce": "Produce",
    "dairy": "Dairy & eggs",
    "meat": "Meat & fish",
    "bakery": "Bakery",
    "pantry": "Pantry",
    "frozen": "Frozen",
    "snacks": "Snacks",
    "drinks": "Drinks",
    "household": "Household",
    "other": "Other",
}


def guess_category(name: str) -> str:
    lowered = name.lower()
    for category, needles in CATEGORY_HINTS:
        if any(needle in lowered for needle in needles):
            return category
    return "other"
