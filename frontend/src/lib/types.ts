export type VesselId = 'LAD' | 'LCX' | 'RCA'
export type TargetId = 'CAD' | VesselId
export const TARGETS: TargetId[] = ['CAD', 'LAD', 'LCX', 'RCA']
export const VESSELS: VesselId[] = ['LAD', 'LCX', 'RCA']

export interface FeatureSpec {
  key: string
  column: string
  label: string
  group: string
  kind: 'binary' | 'numeric' | 'ordinal' | 'categorical'
  unit: string
  normal: [number, number] | null
  minimum: number | null
  maximum: number | null
  step: number | null
  options: [number | string, string][] | null
  modifiable: boolean
  description: string
}

export type Inputs = Record<string, number | string>

export interface TargetPrediction {
  p: number               // calibrated probability
  lo: number              // bootstrap 90% interval
  hi: number
  set: (0 | 1)[]          // conformal prediction set at 1 - alpha
  threshold: number       // operating threshold (Youden, chosen in CV)
  positive: boolean
}

export interface Attribution {
  base: number                         // model output at the reference patient (log-odds)
  value: number                        // model output for this patient (log-odds)
  contributions: Record<string, number> // per-feature, sums to value - base
}

export interface Prediction {
  targets: Record<TargetId, TargetPrediction>
  attributions: Record<TargetId, Attribution>
  engine: 'server' | 'browser'
  ms: number
}

export interface DatasetPatient {
  id: number
  inputs: Inputs
  labels: Record<TargetId, 0 | 1>
  oof: Record<TargetId, number>   // out-of-fold probability (never seen in training of the model that scored it)
}

export interface ModelCard {
  created: string
  dataset: { name: string; n: number; prevalence: Record<TargetId, number>; url: string }
  alpha: number
  targets: Record<TargetId, any>
  comparison: Record<TargetId, { model: string; auc: [number, number]; brier: [number, number]; f1: [number, number]; accuracy: [number, number] }[]>
  sanity: any
  subgroups?: Record<string, any>
  shap_check?: any
  ablation?: any
  external?: any        // ml/external_validation.py
  split_optimism?: any  // ml/split_optimism.py
}
