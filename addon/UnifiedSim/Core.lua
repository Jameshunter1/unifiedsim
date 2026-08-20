local addonName, Core = ...

local PREFIX = "|cff59c8ffUnifiedSim|r: "
local function say(fmt, ...)
    print(PREFIX .. (select("#", ...) > 0 and fmt:format(...) or fmt))
end

local frame = CreateFrame("Frame")
local pendingSnapshot = false

--[[
Scores how complete a snapshot is.

A profile is only useful if it carries spec, talents and gear, and the client
does not always have all three available. Scoring lets a later snapshot be
compared against the stored one instead of blindly replacing it.
]]
local function snapshotQuality(simc, itemStrings)
    if not simc then return -1 end
    local score = 0
    if simc:find("\nspec=", 1, true) then score = score + 4 end
    if simc:find("\ntalents=", 1, true) then score = score + 4 end
    for _ in pairs(itemStrings or {}) do score = score + 1 end
    return score
end

--[[
Writes the current character into the SavedVariables table.

Nothing reaches disk here. The client holds SavedVariables in memory and only
serialises them on a graceful logout, a character switch, or ReloadUI(). That
is why /usim sync exists: it snapshots and then reloads, so the desktop bridge
sees the change within a few hundred milliseconds instead of at next logout.

A degraded snapshot never replaces a better one. This matters most at logout:
the client has already torn down player state by then, so GetSpecialization
returns 0 and every GetInventoryItemLink returns nil. Since the logout snapshot
is the last write before the client serialises to disk, without this guard it
would overwrite a good profile with an empty one *every single session* -- the
exported file would always be the useless one.
]]
local function snapshot(reason)
    local simc, itemStrings, notes = Core.Serializer:ExportCharacterProfile()
    if not simc then
        say("could not build a profile.")
        return nil
    end

    UnifiedSimDB = UnifiedSimDB or { version = 1, profiles = {} }
    UnifiedSimDB.profiles = UnifiedSimDB.profiles or {}

    local key = (UnitName("player") or "Unknown") .. "-" .. (GetRealmName() or "Unknown")
    local quality = snapshotQuality(simc, itemStrings)
    local existing = UnifiedSimDB.profiles[key]

    if existing and quality < (existing.quality or 0) then
        if reason ~= "logout" and reason ~= "auto" then
            say("skipped: this snapshot is less complete than the stored one (%d vs %d).",
                quality, existing.quality or 0)
        end
        return nil
    end

    UnifiedSimDB.profiles[key] = {
        simc = simc,
        itemStrings = itemStrings,
        exportedAt = date("%Y-%m-%dT%H:%M:%S"),
        reason = reason,
        notes = notes,
        quality = quality,
    }
    UnifiedSimDB.lastProfile = key

    -- Notes on an automatic snapshot are noise; on a deliberate one they are
    -- the explanation for why the export looks wrong.
    if reason ~= "auto" and reason ~= "logout" then
        for _, note in ipairs(notes or {}) do
            say("|cffffd100note|r %s", note)
        end
    end
    return key
end

Core.Snapshot = snapshot

--[[
Coalesces bursts of change events.

Swapping a full set of gear fires PLAYER_EQUIPMENT_CHANGED once per slot; a
single snapshot after things settle is enough.
]]
local function scheduleSnapshot()
    if pendingSnapshot then return end
    pendingSnapshot = true
    C_Timer.After(2, function()
        pendingSnapshot = false
        if InCombatLockdown() then
            -- Retry after combat rather than serialising mid-fight.
            frame:RegisterEvent("PLAYER_REGEN_ENABLED")
            return
        end
        snapshot("auto")
    end)
end

local function copyDialog(text)
    if not UnifiedSimCopyFrame then
        local f = CreateFrame("Frame", "UnifiedSimCopyFrame", UIParent, "BasicFrameTemplateWithInset")
        f:SetSize(560, 420)
        f:SetPoint("CENTER")
        f:SetMovable(true)
        f:EnableMouse(true)
        f:RegisterForDrag("LeftButton")
        f:SetScript("OnDragStart", f.StartMoving)
        f:SetScript("OnDragStop", f.StopMovingOrSizing)
        f.title = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
        f.title:SetPoint("TOP", 0, -6)
        f.title:SetText("UnifiedSim export")

        local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
        scroll:SetPoint("TOPLEFT", 12, -32)
        scroll:SetPoint("BOTTOMRIGHT", -32, 12)

        local edit = CreateFrame("EditBox", nil, scroll)
        edit:SetMultiLine(true)
        edit:SetFontObject(ChatFontNormal)
        edit:SetWidth(500)
        edit:SetAutoFocus(false)
        edit:SetScript("OnEscapePressed", function() f:Hide() end)
        scroll:SetScrollChild(edit)
        f.edit = edit
    end

    UnifiedSimCopyFrame.edit:SetText(text)
    UnifiedSimCopyFrame.edit:HighlightText()
    UnifiedSimCopyFrame.edit:SetFocus()
    UnifiedSimCopyFrame:Show()
end

SLASH_UNIFIEDSIM1 = "/usim"
SLASH_UNIFIEDSIM2 = "/unifiedsim"

SlashCmdList.UNIFIEDSIM = function(msg)
    local command = (msg or ""):lower():match("^%s*(%S*)")

    if command == "sync" then
        if InCombatLockdown() then
            say("not while in combat.")
            return
        end
        if snapshot("manual") then
            say("snapshot taken, reloading so the bridge can see it...")
            C_Timer.After(0.2, ReloadUI)
        end
        return
    end

    if command == "copy" then
        local simc = Core.Serializer:ExportCharacterProfile()
        copyDialog(simc)
        return
    end

    if command == "save" then
        local key = snapshot("manual")
        if key then
            say("saved |cffffffff%s|r. Run /reload (or log out) to flush it to disk.", key)
        end
        return
    end

    say("commands:")
    say("  |cffffffff/usim sync|r  snapshot and reload -- the bridge picks it up immediately")
    say("  |cffffffff/usim save|r  snapshot only; flushed on your next reload or logout")
    say("  |cffffffff/usim copy|r  show the profile text to copy by hand")
end

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:RegisterEvent("PLAYER_EQUIPMENT_CHANGED")
frame:RegisterEvent("TRAIT_CONFIG_UPDATED")
frame:RegisterEvent("PLAYER_SPECIALIZATION_CHANGED")

frame:SetScript("OnEvent", function(self, event, arg1)
    if event == "ADDON_LOADED" and arg1 == addonName then
        UnifiedSimDB = UnifiedSimDB or { version = 1, profiles = {} }
        return
    end

    if event == "PLAYER_LOGIN" then
        say("ready. |cffffffff/usim sync|r to snapshot and reload.")
        C_Timer.After(5, function() snapshot("login") end)
        return
    end

    if event == "PLAYER_LOGOUT" then
        -- Runs before the client serialises SavedVariables, so this snapshot
        -- does reach disk.
        snapshot("logout")
        return
    end

    if event == "PLAYER_REGEN_ENABLED" then
        self:UnregisterEvent("PLAYER_REGEN_ENABLED")
        scheduleSnapshot()
        return
    end

    scheduleSnapshot()
end)
