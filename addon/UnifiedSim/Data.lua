local _, Core = ...

--[[
Lookup tables keyed by numeric IDs rather than names.

Every one of these could be derived from a localised string returned by the
client, and every one of those derivations breaks on a non-English client.
Specialisation IDs, race file tokens and SkillLine IDs are locale-independent,
so they are what we key on.
]]

Core.Data = {}

-- Specialisation ID -> SimulationCraft spec token.
-- simc disambiguates by class, so `frost` is unambiguous for both the mage and
-- the death knight.
Core.Data.SPEC_TOKENS = {
    -- Death Knight
    [250] = "blood", [251] = "frost", [252] = "unholy",
    -- Demon Hunter
    [577] = "havoc", [581] = "vengeance",
    -- Druid
    [102] = "balance", [103] = "feral", [104] = "guardian", [105] = "restoration",
    -- Evoker
    [1467] = "devastation", [1468] = "preservation", [1473] = "augmentation",
    -- Hunter
    [253] = "beast_mastery", [254] = "marksmanship", [255] = "survival",
    -- Mage
    [62] = "arcane", [63] = "fire", [64] = "frost",
    -- Monk
    [268] = "brewmaster", [269] = "windwalker", [270] = "mistweaver",
    -- Paladin
    [65] = "holy", [66] = "protection", [70] = "retribution",
    -- Priest
    [256] = "discipline", [257] = "holy", [258] = "shadow",
    -- Rogue
    [259] = "assassination", [260] = "outlaw", [261] = "subtlety",
    -- Shaman
    [262] = "elemental", [263] = "enhancement", [264] = "restoration",
    -- Warlock
    [265] = "affliction", [266] = "demonology", [267] = "destruction",
    -- Warrior
    [71] = "arms", [72] = "fury", [73] = "protection",
}

-- Roles simc expects, by specialisation ID. Anything absent falls back to the
-- client's own role string.
Core.Data.SPEC_ROLES = {
    [62] = "spell", [63] = "spell", [64] = "spell",
    [102] = "spell", [105] = "spell",
    [256] = "spell", [257] = "spell", [258] = "spell",
    [265] = "spell", [266] = "spell", [267] = "spell",
    [262] = "spell", [264] = "spell",
    [1467] = "spell", [1468] = "spell", [1473] = "spell",
    [250] = "tank", [104] = "tank", [268] = "tank", [66] = "tank", [73] = "tank",
    [581] = "tank",
}

--[[
Race file token -> simc race token.

UnitRace's second return is the file token, which is English on every client.
Note that Undead's file token is "Scourge", so lowercasing the file token is
not sufficient -- this mapping exists precisely for cases like that.
]]
Core.Data.RACE_TOKENS = {
    Human = "human",
    Dwarf = "dwarf",
    NightElf = "night_elf",
    Gnome = "gnome",
    Draenei = "draenei",
    Worgen = "worgen",
    Pandaren = "pandaren",
    Orc = "orc",
    Scourge = "undead",
    Tauren = "tauren",
    Troll = "troll",
    BloodElf = "blood_elf",
    Goblin = "goblin",
    VoidElf = "void_elf",
    LightforgedDraenei = "lightforged_draenei",
    HighmountainTauren = "highmountain_tauren",
    Nightborne = "nightborne",
    MagharOrc = "maghar_orc",
    DarkIronDwarf = "dark_iron_dwarf",
    ZandalariTroll = "zandalari_troll",
    KulTiran = "kul_tiran",
    Vulpera = "vulpera",
    Mechagnome = "mechagnome",
    Dracthyr = "dracthyr",
    EarthenDwarf = "earthen_dwarf",
}

-- SkillLine ID -> simc profession token.
Core.Data.PROFESSION_TOKENS = {
    [164] = "blacksmithing",
    [165] = "leatherworking",
    [171] = "alchemy",
    [182] = "herbalism",
    [186] = "mining",
    [197] = "tailoring",
    [202] = "engineering",
    [333] = "enchanting",
    [393] = "skinning",
    [755] = "jewelcrafting",
    [773] = "inscription",
}

--[[
Inventory slot ID -> simc slot token, in the order simc emits them.

Ordered as an array so the export lists slots the same way the SimulationCraft
addon does, which keeps diffs between the two readable.
]]
Core.Data.SLOTS = {
    { id = 1,  token = "head" },
    { id = 2,  token = "neck" },
    { id = 3,  token = "shoulder" },
    { id = 15, token = "back" },
    { id = 5,  token = "chest" },
    { id = 4,  token = "shirt" },
    { id = 19, token = "tabard" },
    { id = 9,  token = "wrist" },
    { id = 10, token = "hands" },
    { id = 6,  token = "waist" },
    { id = 7,  token = "legs" },
    { id = 8,  token = "feet" },
    { id = 11, token = "finger1" },
    { id = 12, token = "finger2" },
    { id = 13, token = "trinket1" },
    { id = 14, token = "trinket2" },
    { id = 16, token = "main_hand" },
    { id = 17, token = "off_hand" },
}
