import { ItemStack } from "@minecraft/server"
import { BOUNTIFUL_CROPS_BY_BLOCK } from "../config/bountifulCrops.generated.js"

const MAX_FORTUNE_LEVEL = 3
const FORTUNE_MULTIPLIERS = Object.freeze([1, 1.2, 1.4, 1.6])

export function getCropDefinition(blockOrTypeId) {
    const typeId = typeof blockOrTypeId === "string"
        ? blockOrTypeId
        : blockOrTypeId?.typeId ?? blockOrTypeId?.type?.id
    return typeId ? BOUNTIFUL_CROPS_BY_BLOCK[typeId] ?? null : null
}

function getFortuneLevel(tool) {
    const level = tool
        ?.getComponent("minecraft:enchantable")
        ?.getEnchantment("minecraft:fortune")
        ?.level ?? 0
    return Math.max(0, Math.min(MAX_FORTUNE_LEVEL, Math.trunc(level)))
}

function rollAmount(amount) {
    if (!Array.isArray(amount)) return amount
    const [min, max] = amount
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function stochasticRound(value) {
    const whole = Math.floor(value)
    return whole + (Math.random() < value - whole ? 1 : 0)
}

function spawnItem(dimension, location, typeId, amount) {
    if (!Number.isInteger(amount) || amount <= 0) return
    dimension.spawnItem(new ItemStack(typeId, amount), location)
}

function spawnResourceDrops(definition, dimension, location, multiplier) {
    for (const drop of definition.drops) {
        if (Math.random() >= drop.chance) continue
        const amount = stochasticRound(rollAmount(drop.amount) * multiplier)
        spawnItem(dimension, location, drop.item, amount)
    }
}

function spawnAdditionalSeed(definition, dimension, location) {
    if (Math.random() < definition.seedChance) {
        spawnItem(dimension, location, definition.seedId, 1)
    }
}

function harvestCrop(block, tool) {
    const definition = getCropDefinition(block)
    if (!definition || block.permutation.getState("utilitycraft:age") !== 5) return false

    const fortuneLevel = getFortuneLevel(tool)
    spawnResourceDrops(
        definition,
        block.dimension,
        block.location,
        FORTUNE_MULTIPLIERS[fortuneLevel]
    )
    spawnAdditionalSeed(definition, block.dimension, block.location)
    block.setPermutation(block.permutation.withState("utilitycraft:age", 0))
    return true
}

function spawnBrokenCropFortuneBonus(definition, dimension, location, tool) {
    const fortuneLevel = getFortuneLevel(tool)
    if (fortuneLevel <= 0) return

    const bonusMultiplier = FORTUNE_MULTIPLIERS[fortuneLevel] - 1
    for (const drop of definition.drops) {
        if (Math.random() >= drop.chance) continue
        const bonusAmount = stochasticRound(rollAmount(drop.amount) * bonusMultiplier)
        spawnItem(dimension, location, drop.item, bonusAmount)
    }
}

export const CROP_COMPONENT = {
    onTick({ block }) {
        const age = block.permutation.getState("utilitycraft:age")
        if (typeof age === "number" && age < 5) {
            block.setPermutation(block.permutation.withState("utilitycraft:age", age + 1))
        }
    },

    onPlayerInteract({ block, player }) {
        const tool = player
            ?.getComponent("minecraft:equippable")
            ?.getEquipment("Mainhand")

        if (!harvestCrop(block, tool)) return
        block.dimension.playSound("dig.grass", block.location)
    },

    onPlayerBreak({ block, brokenBlockPermutation, player }) {
        const definition = getCropDefinition(brokenBlockPermutation)
        if (!definition || brokenBlockPermutation.getState("utilitycraft:age") !== 5) return

        const tool = player
            ?.getComponent("minecraft:equippable")
            ?.getEquipment("Mainhand")

        // Mature plants always return the seed needed to replant them.
        spawnItem(block.dimension, block.location, definition.seedId, 1)
        spawnBrokenCropFortuneBonus(definition, block.dimension, block.location, tool)
    }
}
