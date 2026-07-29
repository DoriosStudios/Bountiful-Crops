# Bountiful Crops

Standalone Minecraft Bedrock add-on rebuilt from the current Bountiful Crops module in UtilityCraft.

It contains the complete resource-crop system: 32 crops, their seeds and drops, four soil tiers, the pedestal, and the three accelerator clocks.

## Development

```powershell
npm run generate
npm run validate
npm run bundle
```

`tools/data/bountiful_crops.json` is the canonical crop catalog. Run `npm run generate` after changing crop balance, drops, growth intervals, or resource metadata.

The published Bountiful Crops 2.2 pack UUIDs are retained so this project can be released as an update to the existing add-on. Content now uses UtilityCraft's current `utilitycraft:` identifiers; legacy `twm:` blocks and items are not silently remapped.
