import type { PropertyData, UnitInfo, UtilitiesPayer } from '../lib/underwriting'
import { Banner, Card, NumField, SelectField, TextField } from './ui'

interface Props {
  property: PropertyData
  unverified: Set<string>
  onChange: (p: PropertyData) => void
  onConfirm: (field: string) => void
  onConfirmAll: () => void
}

export default function PropertyForm({ property, unverified, onChange, onConfirm, onConfirmAll }: Props) {
  const set = <K extends keyof PropertyData>(key: K, value: PropertyData[K]) => {
    onChange({ ...property, [key]: value })
    onConfirm(key as string) // editing a field counts as verifying it
  }

  const setUnit = (i: number, patch: Partial<UnitInfo>) => {
    const units = property.units.map((u, j) => (j === i ? { ...u, ...patch } : u))
    onChange({ ...property, units })
    onConfirm('unitCount')
  }

  const addUnit = () => {
    const n = property.units.length + 1
    set('units', [...property.units, { label: `Unit ${n}`, beds: 2, baths: 1, currentRent: 0, marketRent: 0 }])
    onConfirm('unitCount')
  }

  const removeUnit = (i: number) => {
    set('units', property.units.filter((_, j) => j !== i))
  }

  const uv = (f: string) => unverified.has(f)

  return (
    <div className="space-y-6">
      {unverified.size > 0 && (
        <Banner tone="warn">
          <div className="flex items-center justify-between gap-4">
            <span>
              <strong>{unverified.size} field(s) came from the listing and are unverified.</strong> Listing data lies —
              confirm or correct each highlighted field before it feeds the math.
            </span>
            <button
              type="button"
              onClick={onConfirmAll}
              className="shrink-0 rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-bold hover:bg-amber-100"
            >
              I've checked them all ✓
            </button>
          </div>
        </Banner>
      )}

      <Card title="Property">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField label="Address" value={property.address} onChange={(v) => set('address', v)} unverified={uv('address')} onConfirm={() => onConfirm('address')} />
          </div>
          <NumField label="Asking price" prefix="$" value={property.price} onChange={(v) => set('price', v ?? 0)} unverified={uv('price')} onConfirm={() => onConfirm('price')} />
          <NumField label="Annual property taxes (actual)" prefix="$" value={property.annualTaxes} onChange={(v) => set('annualTaxes', v ?? 0)} unverified={uv('annualTaxes')} onConfirm={() => onConfirm('annualTaxes')} />
          <NumField label="Year built" value={property.yearBuilt} onChange={(v) => set('yearBuilt', v)} allowEmpty unverified={uv('yearBuilt')} onConfirm={() => onConfirm('yearBuilt')} />
          <NumField label="Finished sqft" value={property.sqft} onChange={(v) => set('sqft', v)} allowEmpty unverified={uv('sqft')} onConfirm={() => onConfirm('sqft')} />
          <TextField label="Lot size" value={property.lotSize} onChange={(v) => set('lotSize', v)} placeholder="e.g. 0.18 acres" unverified={uv('lotSize')} onConfirm={() => onConfirm('lotSize')} />
          <NumField label="Parking spaces" value={property.parkingSpaces} onChange={(v) => set('parkingSpaces', v)} allowEmpty unverified={uv('parkingSpaces')} onConfirm={() => onConfirm('parkingSpaces')} />
          <TextField label="Heat type" value={property.heatType} onChange={(v) => set('heatType', v)} placeholder="e.g. hot water baseboard, oil" unverified={uv('heatType')} onConfirm={() => onConfirm('heatType')} />
          <SelectField<UtilitiesPayer>
            label="Who pays utilities"
            value={property.utilitiesPaidBy}
            onChange={(v) => set('utilitiesPaidBy', v)}
            options={[
              { value: 'tenant', label: 'Tenants pay' },
              { value: 'owner', label: 'Owner pays' },
              { value: 'mixed', label: 'Mixed / split' },
            ]}
          />
          <NumField
            label="Listed gross income (reference only)"
            prefix="$"
            value={property.listedGrossIncome}
            onChange={(v) => set('listedGrossIncome', v)}
            allowEmpty
            hint="Never used in the math — income is rebuilt from unit rents below."
            unverified={uv('listedGrossIncome')}
            onConfirm={() => onConfirm('listedGrossIncome')}
          />
        </div>
      </Card>

      <Card title={`Unit mix & current rents (${property.units.length} units)`}>
        {uv('unitCount') && (
          <div className="mb-3">
            <Banner tone="warn">
              The listing supplied this unit mix and these rents — verify each row against actual leases, then confirm.
            </Banner>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-3">Unit</th>
                <th className="pb-2 pr-3">Beds</th>
                <th className="pb-2 pr-3">Baths</th>
                <th className="pb-2 pr-3">Current rent /mo</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {property.units.map((u, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 pr-3">
                    <input className="w-24 rounded-md border border-slate-300 px-2 py-1.5" value={u.label} onChange={(e) => setUnit(i, { label: e.target.value })} />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="number" className="w-16 rounded-md border border-slate-300 px-2 py-1.5" value={u.beds} onChange={(e) => setUnit(i, { beds: Number(e.target.value) })} />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="number" step="0.5" className="w-16 rounded-md border border-slate-300 px-2 py-1.5" value={u.baths} onChange={(e) => setUnit(i, { baths: Number(e.target.value) })} />
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center rounded-md border border-slate-300">
                      <span className="pl-2 text-slate-400">$</span>
                      <input type="number" className="w-28 border-0 px-2 py-1.5 outline-none" value={u.currentRent || ''} onChange={(e) => setUnit(i, { currentRent: Number(e.target.value) })} />
                    </div>
                  </td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => removeUnit(i)} className="text-xs text-slate-400 hover:text-red-500">
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addUnit} className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-indigo-400 hover:text-indigo-600">
          + Add unit
        </button>
      </Card>
    </div>
  )
}
