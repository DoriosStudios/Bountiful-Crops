import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const toolsDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(toolsDirectory, "..")
const cropCatalog = JSON.parse(await readFile(
    join(toolsDirectory, "data", "bountiful_crops.json"),
    "utf8"
))

const seedIds = cropCatalog.crops.map(crop => crop.seedId)
const soilIds = [
    "utilitycraft:yellow_soil",
    "utilitycraft:red_soil",
    "utilitycraft:blue_soil",
    "utilitycraft:black_soil"
]
const utilityItemIds = [
    "utilitycraft:base_seeds",
    "utilitycraft:water_ball",
    "utilitycraft:lava_ball",
    "utilitycraft:honey_ball",
    "utilitycraft:diamond_shard",
    "utilitycraft:emerald_shard",
    "utilitycraft:netherite_nugget",
    "utilitycraft:nether_star_fragment",
    "utilitycraft:shulker_shell_shard",
    "utilitycraft:totem_shard",
    "utilitycraft:wither_skull_shard",
    "utilitycraft:accelerator_clock",
    "utilitycraft:diamond_accelerator_clock",
    "utilitycraft:nether_star_accelerator_clock"
]
const entityIds = [
    "utilitycraft:accelerator_clock",
    "utilitycraft:diamond_accelerator_clock",
    "utilitycraft:nether_star_accelerator_clock"
]
const blockIds = [...seedIds, ...soilIds, "utilitycraft:pedestal"]
const translatableIds = new Set([
    ...blockIds,
    ...seedIds,
    ...utilityItemIds,
    ...entityIds
])
const itemTextureKeys = new Set([
    ...seedIds,
    ...utilityItemIds
].map(identifier => identifier.replace(":", "_")))
itemTextureKeys.add("utilitycraft_waterball")
itemTextureKeys.add("utilitycraft_lavaball")

await filterAtlas(
    join(projectRoot, "RP", "textures", "terrain_texture.json"),
    path => path.startsWith("textures/blocks/crops/") ||
        path === "textures/blocks/utility/pedestal",
    "Bountiful Crops"
)

await filterAtlas(
    join(projectRoot, "RP", "textures", "item_texture.json"),
    (_path, key) => itemTextureKeys.has(key),
    "Bountiful Crops"
)

const blocksPath = join(projectRoot, "RP", "blocks.json")
const blocks = parseJsonc(await readFile(blocksPath, "utf8"))
const filteredBlocks = { format_version: blocks.format_version }
for (const identifier of blockIds) {
    if (!blocks[identifier]) throw new Error(`Missing RP block metadata: ${identifier}`)
    filteredBlocks[identifier] = blocks[identifier]
}
await writeJson(blocksPath, filteredBlocks)

const textsDirectory = join(projectRoot, "RP", "texts")
const languages = JSON.parse(await readFile(join(textsDirectory, "languages.json"), "utf8"))
const englishLines = (await readFile(join(textsDirectory, "en_US.lang"), "utf8")).split(/\r?\n/)
for (const language of languages) {
    const path = join(textsDirectory, `${language}.lang`)
    const lines = (await readFile(path, "utf8")).split(/\r?\n/)
    const keptLines = lines
        .filter(line => {
            if (!line || line.startsWith("#")) return false
            return [...translatableIds].some(identifier => line.includes(identifier))
        })
        .map(line => line.replaceAll("@UtilityCraft", "@Bountiful Crops"))
        .filter(line => !seedIds.some(seedId => line.startsWith(`tile.${seedId}.name=`)))
    for (const seedId of seedIds) {
        const itemPrefix = `item.${seedId}=`
        const tilePrefix = `tile.${seedId}.name=`
        let itemLine = keptLines.find(line => line.startsWith(itemPrefix))
        if (!itemLine) {
            itemLine = englishLines.find(line => line.startsWith(itemPrefix))
            if (!itemLine) throw new Error(`Missing fallback translation for ${seedId}`)
            keptLines.push(itemLine)
        }
        keptLines.push(`${tilePrefix}${itemLine.slice(itemPrefix.length)}`)
    }
    const header = [
        "pack.name=Bountiful Crops",
        "pack.description=Standalone resource crops, soils, pedestal, and accelerator clocks"
    ]
    await writeFile(path, `${[...header, ...keptLines].join("\n")}\n`, "utf8")
}

console.log(
    `Generated resource metadata for ${seedIds.length} crops, ` +
    `${seedIds.length + utilityItemIds.length} items, and ${blockIds.length} blocks.`
)

async function filterAtlas(path, includeTexture, resourcePackName) {
    const atlas = JSON.parse(await readFile(path, "utf8"))
    const textureData = {}

    for (const [key, definition] of Object.entries(atlas.texture_data)) {
        const paths = Array.isArray(definition.textures)
            ? definition.textures
            : [definition.textures]
        if (paths.some(texturePath => includeTexture(texturePath, key))) {
            textureData[key] = definition
        }
    }

    if (Object.keys(textureData).length === 0) {
        throw new Error(`No related textures found in ${path}`)
    }

    await writeJson(path, {
        ...atlas,
        resource_pack_name: resourcePackName,
        texture_data: textureData
    })
}

async function writeJson(path, value) {
    await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`, "utf8")
}

function parseJsonc(source) {
    return JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""))
}
