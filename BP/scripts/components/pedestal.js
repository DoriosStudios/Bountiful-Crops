import { ItemStack, system } from "@minecraft/server"
import { BOUNTIFUL_CROPS_BY_BLOCK } from "../config/bountifulCrops.generated.js"
import {
    ACCELERATOR_CLOCKS_BY_ENTITY,
    ACCELERATOR_CLOCKS_BY_ITEM,
    findAcceleratorClock,
    getAcceleratorClockFromEntity,
    getClockDisplayLocation
} from "../config/acceleratorClocks.js"

const PEDESTAL_ID = "utilitycraft:pedestal"
const PEDESTAL_OUTLINE_ENTITY_ID = "utilitycraft:pedestal_area_outline"
const PEDESTAL_SETTINGS = Object.freeze({
    radius: 4,
    cropsPerCycle: 27,
    particleChance: 0.25
})

const CROP_TIER_MULTIPLIERS = Object.freeze({
    1: 1,
    2: 4 / 7,
    3: 4 / 11,
    4: 1 / 4
})

function getOutlineLocation(block) {
    const { x, y, z } = block.location
    return { x: x + 0.5, y, z: z + 0.5 }
}

function removePedestalAreaOutline(block) {
    try {
        const outlines = block.dimension.getEntities({
            type: PEDESTAL_OUTLINE_ENTITY_ID,
            location: getOutlineLocation(block),
            maxDistance: 0.75
        })
        for (const outline of outlines) outline.remove()
    } catch (error) {
        console.warn(`[Bountiful Crops] Could not remove pedestal outline: ${error}`)
    }
}

function showPedestalAreaOutline(block) {
    removePedestalAreaOutline(block)
    try {
        block.dimension.spawnEntity(PEDESTAL_OUTLINE_ENTITY_ID, getOutlineLocation(block))
    } catch (error) {
        console.warn(`[Bountiful Crops] Could not display pedestal outline: ${error}`)
    }
}

function removeClockEntity(entity) {
    if (!entity) return
    try {
        entity.remove()
    } catch {
        entity.addTag("despawn")
    }
}

function takeOneMainHandItem(player, itemId) {
    try {
        player.runCommand(`clear @s ${itemId} 0 1`)
    } catch (error) {
        console.warn(`[Bountiful Crops] Could not consume ${itemId}: ${error}`)
    }
}

function interactWithPedestal(block, player) {
    const state = block.permutation.getState("utilitycraft:hasItem")
    const dimension = block.dimension
    const displayLocation = getClockDisplayLocation(block)

    if (state === 1) {
        const clockEntity = findAcceleratorClock(dimension, displayLocation, 1)
        const clock = getAcceleratorClockFromEntity(clockEntity)
        removeClockEntity(clockEntity)
        removePedestalAreaOutline(block)

        const itemId = clock?.itemId ?? "utilitycraft:accelerator_clock"
        dimension.spawnItem(new ItemStack(itemId, 1), displayLocation)
        block.setPermutation(block.permutation.withState("utilitycraft:hasItem", 0))
        return
    }

    const mainHand = player
        ?.getComponent("minecraft:equippable")
        ?.getEquipment("Mainhand")
    const clock = mainHand ? ACCELERATOR_CLOCKS_BY_ITEM[mainHand.typeId] : null
    if (!clock || state !== 0) return

    const clockAlreadyPresent = dimension.getEntities({
        location: displayLocation,
        maxDistance: 1
    }).some(entity => ACCELERATOR_CLOCKS_BY_ENTITY[entity.typeId])
    if (clockAlreadyPresent) return

    dimension.spawnEntity(clock.entityId, displayLocation)
    takeOneMainHandItem(player, clock.itemId)
    block.setPermutation(block.permutation.withState("utilitycraft:hasItem", 1))
    showPedestalAreaOutline(block)
}

function getRandomPosition({ x, y, z }, radius) {
    return {
        x: x + Math.floor(Math.random() * (radius * 2 + 1)) - radius,
        y,
        z: z + Math.floor(Math.random() * (radius * 2 + 1)) - radius
    }
}

function getCropTierMultiplier(block) {
    const tier = BOUNTIFUL_CROPS_BY_BLOCK[block.typeId]?.tier ?? 1
    return CROP_TIER_MULTIPLIERS[tier] ?? 1
}

function getMaxState(block, key, maxTry = 16) {
    const permutation = block.permutation
    const current = permutation.getState(key)
    if (typeof current !== "number") return null

    let lastValid = current
    for (let value = current + 1; value <= maxTry; value++) {
        try {
            permutation.withState(key, value)
            lastValid = value
        } catch {
            break
        }
    }
    return lastValid
}

function tryAdvanceState(block, key, current, maximum, chance, bonusStepChance) {
    if (current >= maximum || Math.random() >= chance) return false

    let steps = 1
    if (current + steps < maximum && Math.random() < bonusStepChance) steps++

    block.setPermutation(block.permutation.withState(
        key,
        Math.min(maximum, current + steps)
    ))

    if (Math.random() <= PEDESTAL_SETTINGS.particleChance) {
        block.dimension.spawnParticle("minecraft:crop_growth_emitter", block.center())
    }
    return true
}

function tryGrowCrop(block, clock) {
    if (!block || !clock) return false

    const chance = Math.min(1, clock.baseChance * getCropTierMultiplier(block))
    const bonusStepChance = clock.bonusStepChance ?? 0
    const utilityAge = block.permutation.getState("utilitycraft:age")

    if (typeof utilityAge === "number") {
        return tryAdvanceState(
            block,
            "utilitycraft:age",
            utilityAge,
            5,
            chance,
            bonusStepChance
        )
    }

    const vanillaGrowth = block.permutation.getState("growth")
    if (typeof vanillaGrowth === "number") {
        const maximum = getMaxState(block, "growth")
        return maximum === null
            ? false
            : tryAdvanceState(block, "growth", vanillaGrowth, maximum, chance, bonusStepChance)
    }

    const namespace = block.typeId.split(":")[0]
    const candidates = new Set([
        `${namespace}:growth`,
        `${namespace}:crop`,
        `${namespace}:age`,
        "crop",
        "age"
    ])

    for (const key of candidates) {
        const value = block.permutation.getState(key)
        if (typeof value !== "number") continue

        const maximum = getMaxState(block, key)
        return maximum === null
            ? false
            : tryAdvanceState(block, key, value, maximum, chance, bonusStepChance)
    }
    return false
}

export const INTERACT_COMPONENT = {
    onPlayerInteract({ block, player }) {
        if (block.typeId === PEDESTAL_ID) interactWithPedestal(block, player)
    }
}

export const PEDESTAL_COMPONENT = {
    async onTick({ block }) {
        if (block.permutation.getState("utilitycraft:hasItem") !== 1) return

        const clockEntity = findAcceleratorClock(
            block.dimension,
            getClockDisplayLocation(block),
            1
        )
        const clock = getAcceleratorClockFromEntity(clockEntity)
        if (!clock) return

        const { radius, cropsPerCycle } = PEDESTAL_SETTINGS
        for (let attempt = 0; attempt < cropsPerCycle; attempt++) {
            if (
                block.typeId !== PEDESTAL_ID ||
                block.permutation.getState("utilitycraft:hasItem") !== 1
            ) return

            const target = block.dimension.getBlock(
                getRandomPosition(block.location, radius)
            )
            tryGrowCrop(target, clock)
            await system.waitTicks(1)
        }
    },

    onPlayerBreak({ block, brokenBlockPermutation }) {
        removePedestalAreaOutline(block)
        if (brokenBlockPermutation.getState("utilitycraft:hasItem") !== 1) return

        const clockEntity = findAcceleratorClock(
            block.dimension,
            getClockDisplayLocation(block),
            1.5
        )
        const clock = getAcceleratorClockFromEntity(clockEntity)
        removeClockEntity(clockEntity)

        const itemId = clock?.itemId ?? "utilitycraft:accelerator_clock"
        block.dimension.spawnItem(new ItemStack(itemId, 1), getClockDisplayLocation(block))
    }
}
