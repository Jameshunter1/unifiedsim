local _, Core = ...

local Data = Core.Data
local Serializer = {}
Core.Serializer = Serializer

--[[
Everything here is wrapped in pcall.

An addon that errors during serialisation leaves the player with no export at
all; one that skips a field it could not read still produces a profile that
sims. Blizzard moves these APIs between expansions, so each read is treated as
fallible and the caller gets whatever was available.
]]
local function try(fn, ...)
    local ok, a, b, c, d, e, f, g, h, i, j = pcall(fn, ...)
    if ok then return a, b, c, d, e, f, g, h, i, j end
    return nil
end

--[[
Splits an item link into its parts.

The item string is colon-delimited and positional:
  item:id:enchant:gem1:gem2:gem3:gem4:suffix:unique:level:specID:mask:context
       :numBonusIDs:bonusID... :numModifiers:(modType:modValue)...

Bonus IDs are length-prefixed, so the modifier block can only be found by
first walking the bonus list. Getting this wrong is the usual cause of an
export that sims at the wrong item level.
]]
function Serializer:ParseItemLink(link)
    if not link then return nil end

    local itemString = link:match("|Hitem:([%-%d:]+)|h") or link:match("^item:([%-%d:]+)$")
    if not itemString then return nil end

    local parts = {}
    for value in (itemString .. ":"):gmatch("([%-%d]*):") do
        parts[#parts + 1] = tonumber(value) or 0
    end

    local item = {
        id = parts[1] or 0,
        enchantId = parts[2] or 0,
        gems = {},
        bonusIds = {},
        modifiers = {},
        -- The full item string is kept verbatim so the bridge can recover
        -- fields this addon does not yet model, without an addon update.
        itemString = "item:" .. itemString,
    }
    if item.id == 0 then return nil end

    for offset = 3, 6 do
        local gem = parts[offset]
        if gem and gem ~= 0 then item.gems[#item.gems + 1] = gem end
    end

    local cursor = 14
    local bonusCount = parts[13] or 0
    for _ = 1, bonusCount do
        local bonus = parts[cursor]
        if bonus and bonus ~= 0 then item.bonusIds[#item.bonusIds + 1] = bonus end
        cursor = cursor + 1
    end

    -- Modifier block: a count followed by (type, value) pairs. We record them
    -- all rather than interpreting them, because the type constants are not
    -- documented and change between expansions.
    local modifierCount = parts[cursor] or 0
    cursor = cursor + 1
    for _ = 1, modifierCount do
        local modType, modValue = parts[cursor], parts[cursor + 1]
        if modType then item.modifiers[#item.modifiers + 1] = { modType, modValue or 0 } end
        cursor = cursor + 2
    end

    return item
end

--[[
Renders one `slot=,id=...` line.

The item name is deliberately left empty, matching the SimulationCraft addon:
simc keys on the ID, and a name containing a comma would break its own parser.
The readable name goes in the comment above instead.
]]
function Serializer:ItemToSimc(token, item)
    local fields = { token .. "=" }
    fields[#fields + 1] = "id=" .. item.id
    if item.enchantId and item.enchantId ~= 0 then
        fields[#fields + 1] = "enchant_id=" .. item.enchantId
    end
    if #item.gems > 0 then
        fields[#fields + 1] = "gem_id=" .. table.concat(item.gems, "/")
    end
    if #item.bonusIds > 0 then
        fields[#fields + 1] = "bonus_id=" .. table.concat(item.bonusIds, "/")
    end
    return table.concat(fields, ",")
end

function Serializer:GetSpecInfo()
    local index = try(function()
        if C_SpecializationInfo and C_SpecializationInfo.GetSpecialization then
            return C_SpecializationInfo.GetSpecialization()
        end
        return GetSpecialization and GetSpecialization()
    end)
    if not index then return nil end

    local specId = try(function()
        if C_SpecializationInfo and C_SpecializationInfo.GetSpecializationInfo then
            return C_SpecializationInfo.GetSpecializationInfo(index)
        end
        return GetSpecializationInfo and GetSpecializationInfo(index)
    end)

    -- 0 is not a specialisation. The client returns it while player data is
    -- still loading and again once logout has begun tearing it down, so it must
    -- be treated as "unknown" rather than looked up in the token table.
    if specId == 0 then return nil end
    return specId
end

--[[
The active talent loadout as an import string.

`C_Traits.GenerateImportString` produces exactly the base64 blob simc reads.
The saved-loadout list is best effort: it is useful for comparing builds but
not required for a valid profile.
]]
function Serializer:GetTalents()
    local activeConfig = try(function()
        return C_ClassTalents and C_ClassTalents.GetActiveConfigID()
    end)
    if not activeConfig then return nil, {} end

    local active = try(function()
        return C_Traits and C_Traits.GenerateImportString(activeConfig)
    end)

    local saved = {}
    local specId = self:GetSpecInfo()
    if specId then
        local configIds = try(function()
            return C_ClassTalents and C_ClassTalents.GetConfigIDsBySpecID(specId)
        end)
        for _, configId in ipairs(configIds or {}) do
            local info = try(function() return C_Traits and C_Traits.GetConfigInfo(configId) end)
            local hash = try(function() return C_Traits and C_Traits.GenerateImportString(configId) end)
            if info and info.name and hash and hash ~= active then
                saved[#saved + 1] = { name = info.name, hash = hash }
            end
        end
    end

    return active, saved
end

function Serializer:GetProfessions()
    local out = {}
    local prof1, prof2 = try(GetProfessions)
    for _, index in ipairs({ prof1, prof2 }) do
        if index then
            local name, _, rank, _, _, _, skillLine = try(GetProfessionInfo, index)
            local token = skillLine and Data.PROFESSION_TOKENS[skillLine]
            if token and rank then
                out[#out + 1] = token .. "=" .. rank
            elseif name and rank then
                -- Unknown skill line: fall back to the localised name lowercased,
                -- which simc may still recognise on an English client.
                out[#out + 1] = name:lower():gsub("%s+", "_") .. "=" .. rank
            end
        end
    end
    return out
end

--[[
Builds the full profile.

Returns the simc text plus a table of raw item strings, keyed by slot, so the
bridge has ground truth for fields this serialiser does not emit yet
(crafting quality, crafted stats, content tuning).
]]
function Serializer:ExportCharacterProfile()
    local lines = {}
    local itemStrings = {}
    local notes = {}

    local name = try(UnitName, "player") or "Unknown"
    local realm = try(GetRealmName) or "Unknown"
    local _, classToken = try(UnitClass, "player")
    local _, raceToken = try(UnitRace, "player")
    local level = try(UnitLevel, "player") or 0
    local specId = self:GetSpecInfo()
    local specToken = specId and Data.SPEC_TOKENS[specId]
    local region = try(function() return GetCurrentRegionName and GetCurrentRegionName() end)

    local stamp = date("%Y-%m-%d %H:%M")
    lines[#lines + 1] = ("# %s - %s - %s - %s"):format(
        name,
        specToken and specToken:gsub("^%l", string.upper) or "Unknown",
        stamp,
        realm
    )
    lines[#lines + 1] = "# UnifiedSim addon " .. (C_AddOns and C_AddOns.GetAddOnMetadata
        and (C_AddOns.GetAddOnMetadata("UnifiedSim", "Version") or "?") or "?")
    lines[#lines + 1] = ""

    if classToken then
        lines[#lines + 1] = ("%s=\"%s\""):format(classToken:lower(), name)
    else
        notes[#notes + 1] = "Could not read class; profile will not load without it."
    end

    lines[#lines + 1] = "level=" .. level

    if raceToken then
        local simcRace = Data.RACE_TOKENS[raceToken]
        if simcRace then
            lines[#lines + 1] = "race=" .. simcRace
        else
            lines[#lines + 1] = "race=" .. raceToken:lower()
            notes[#notes + 1] = "Unmapped race token '" .. raceToken .. "'; guessed a simc name."
        end
    end

    if region then lines[#lines + 1] = "region=" .. region:lower() end
    lines[#lines + 1] = "server=" .. realm:lower():gsub("[%s'’]", "")

    if specId then
        local role = Data.SPEC_ROLES[specId]
        if role then lines[#lines + 1] = "role=" .. role end
    end

    local professions = self:GetProfessions()
    if #professions > 0 then
        lines[#lines + 1] = "professions=" .. table.concat(professions, "/")
    end

    if specToken then
        lines[#lines + 1] = "spec=" .. specToken
    else
        notes[#notes + 1] = "Unknown specialisation id " .. tostring(specId) .. "; spec line omitted."
    end

    local active, saved = self:GetTalents()
    lines[#lines + 1] = ""
    if active then
        lines[#lines + 1] = "talents=" .. active
    else
        notes[#notes + 1] = "Could not read the active talent loadout."
    end
    for _, loadout in ipairs(saved) do
        lines[#lines + 1] = ""
        lines[#lines + 1] = "# Saved Loadout: " .. loadout.name
        lines[#lines + 1] = "# talents=" .. loadout.hash
    end

    lines[#lines + 1] = ""

    for _, slot in ipairs(Data.SLOTS) do
        local link = try(GetInventoryItemLink, "player", slot.id)
        if link then
            local item = self:ParseItemLink(link)
            if item then
                local itemName = link:match("%[(.-)%]")
                local itemLevel = try(function()
                    return C_Item and C_Item.GetDetailedItemLevelInfo
                        and C_Item.GetDetailedItemLevelInfo(link)
                end)
                if itemName then
                    lines[#lines + 1] = ("# %s%s"):format(
                        itemName,
                        itemLevel and (" (" .. itemLevel .. ")") or ""
                    )
                end
                lines[#lines + 1] = self:ItemToSimc(slot.token, item)
                itemStrings[slot.token] = item.itemString
            end
        end
    end

    return table.concat(lines, "\n") .. "\n", itemStrings, notes
end
