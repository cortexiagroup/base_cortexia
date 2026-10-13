import { describe, expect, it } from 'vitest'
import { advanceBalance, commissionPotential, type FieldAdvance, type FieldExpense, type FieldRestitution } from './types'

const advance: FieldAdvance = { id:'a1',budget_id:'b1',sales_rep_id:'rep1',requested_xof:5000,
  approved_xof:5000,disbursed_xof:5000,status:'disbursed',handover_proof_path:'private/proof.pdf',
  transfer_reference:'TX-1',disbursed_at:'2026-10-13T00:00:00Z',approved_at:'2026-10-13T00:00:00Z',created_at:'2026-10-13T00:00:00Z' }
const expense = (id:string,category:FieldExpense['category'],amount:number): FieldExpense => ({
  id,sales_rep_id:'rep1',budget_id:'b1',advance_id:'a1',category,funding_source:'advance',
  amount_xof:amount,incurred_at:'2026-10-13T00:00:00Z',period_start:null,period_end:null,
  description:category,prospecting_zone:null,transport_mode:null,proof_path:'private/proof.pdf',
  status:'approved',reimbursement_status:'not_applicable',created_at:'2026-10-13T00:00:00Z',
})
const restitution = (status:FieldRestitution['status']):FieldRestitution => ({
  id:'r1',advance_id:'a1',amount_xof:1500,status,proof_path:'private/return.pdf',
  received_reference:status==='verified'?'CASH-1':null,declared_at:'2026-10-13T00:00:00Z',
})

describe('dotation initiale fictive de 5 000 FCFA',()=>{
  const expenses=[expense('e1','communication',500),expense('e2','transport',2000),expense('e3','other',1000)]
  it('compte la recharge et le transport comme consommations de la même dotation, pas comme nouvelles remises',()=>{
    expect(advanceBalance(advance,expenses,[])).toEqual({funded:5000,justified:3500,returned:0,toRegularize:1500})
  })
  it('ne réduit pas le solde à régulariser sur simple déclaration de retour',()=>{
    expect(advanceBalance(advance,expenses,[restitution('declared')]).toRegularize).toBe(1500)
  })
  it('ne clôture mathématiquement le solde qu’après retour vérifié',()=>{
    expect(advanceBalance(advance,expenses,[restitution('verified')])).toEqual({funded:5000,justified:3500,returned:1500,toRegularize:0})
  })
  it('sépare un transport ultérieur décidé du montant de démarrage',()=>{
    const transportBudget=3000
    expect(advanceBalance(advance,expenses,[]).funded).toBe(5000)
    expect(transportBudget).not.toBe(advance.disbursed_xof)
  })
})

describe('commission fictive explicitement configurée',()=>{
  it('arrondit 10 % de 49 000 FCFA à 4 900 FCFA',()=>{
    expect(commissionPotential(49000,1000)).toBe(4900)
  })
  it('arrondit les FCFA de façon déterministe sur la base cumulée',()=>{
    expect(commissionPotential(24500,1000)).toBe(2450)
    expect(commissionPotential(49000,1000)).toBe(4900)
  })
})
