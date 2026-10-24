import { useState } from "react";
import { useGlassCapabilities } from "../../hooks/useGlassCapabilities";
import { glassTuningFields, type GlassPreset } from "../../lib/glassPresets";
import "./GlassLab.css";

export default function GlassLab() {
  const { enabled, renderer, preset, tuning, toggle, choosePreset, adjustTuning } = useGlassCapabilities();
  const [collapsed, setCollapsed] = useState(false);
  return <aside className="glassLab" aria-label="玻璃材质调参">
    <button type="button" className="glassLabHeading" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>
      玻璃材质 · {preset}<span>{collapsed ? "展开" : "收起"}</span>
    </button>
    {!collapsed && <div className="glassLabBody">
      <div className="glassLabPresets">{(["A", "B", "C"] as GlassPreset[]).map(value => <button key={value} type="button"
        aria-pressed={preset === value} onClick={() => choosePreset(value)}>{value}</button>)}
        <button type="button" onClick={toggle}>{enabled ? "对比简化" : "查看液态"}</button>
      </div>
      <small>当前：{enabled ? "液态" : "简化"} / {renderer}</small>
      {glassTuningFields.map(field => <label key={field.key}>{field.label}<output>{tuning[field.key]}</output>
        <input type="range" min={field.min} max={field.max} step={field.step} value={tuning[field.key]}
          onChange={event => adjustTuning(field.key, Number(event.target.value))} />
      </label>)}
      <output className="glassLabValues">{JSON.stringify(tuning)}</output>
    </div>}
  </aside>;
}
