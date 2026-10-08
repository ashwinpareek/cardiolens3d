import { createContext, useContext } from 'react'
import type { Bundle } from './engine'
import type { DatasetPatient, FeatureSpec, Inputs, ModelCard, Prediction, TargetId, VesselId } from './types'
import type { Preset } from '../components/PatientPanel'
import type { AnatomyPart } from '../three/HeartScene'
import type { Centerlines } from '../three/FlowParticles'

export interface AppData {
  features: FeatureSpec[]
  patients: DatasetPatient[]
  presets: Preset[]
  card: ModelCard
  similar_weights: Record<string, number>
  bundle: Bundle
}

export interface Ctx {
  data: AppData
  registry: AnatomyPart[]
  centerlines: Centerlines | null
  server: boolean
  inputs: Inputs
  baseline: Inputs
  source: string
  pred: Prediction | null
  selected: VesselId | null
  setSelected: (v: VesselId | null) => void
  explainTarget: TargetId
  setExplainTarget: (t: TargetId) => void
  onChange: (key: string, v: number | string) => void
  load: (inputs: Inputs, source: string) => void
  setInputs: (f: (s: Inputs) => Inputs) => void
  risks: Record<VesselId, number>
  uncertain: Record<VesselId, boolean>
  base: string
  staticDemo: boolean
  setMode: (m: 'guide' | 'expert') => void
}

export const AppCtx = createContext<Ctx | null>(null)
export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('AppCtx missing')
  return c
}
