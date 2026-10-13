import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { ledgerBalance } from './types'
import { renderFinancePdf, type FinancePdfPayload } from '../../supabase/functions/_shared/finance-pdf'

const base = {
  document_number: 'CTX-R-2026-000001',
  created_at: '2026-10-12T17:00:00.000Z',
  snapshot: {
    company: { company_name: 'Cortexia', professional_email: 'contact@example.test' },
    order: { order_number: 'CMD-2026-001', amount_xof: 240000,
      offer_snapshot: { name: 'Prestation exemple', client: { company_name: 'Client exemple' } } },
    payment: { status: 'confirmed', amount_xof: 120000, method: 'merchant_account',
      paid_at: '2026-10-12T12:00:00Z', verification_reference: 'REF-123' },
    account: { method: 'merchant_account', provider_name: 'Opérateur exemple' },
    collected_after_xof: 120000, balance_after_xof: 120000,
    amount_due_xof: 120000,
    accounts: [{ method: 'merchant_account', provider_name: 'Opérateur exemple',
      holder_name: 'Cortexia', account_identifier: '00000000', client_instructions: 'Indiquer la référence.' }],
  },
}

describe('journal financier', () => {
  it('ignore les déclarations et calcule le solde net avec les écritures signées', () => {
    expect(ledgerBalance(240000, []).remaining).toBe(240000)
    expect(ledgerBalance(240000, [{ amount_xof: 120000 }]).label).toBe('Partiellement payé')
    expect(ledgerBalance(240000, [{ amount_xof: 120000 }, { amount_xof: -20000 }])).toEqual({
      collected: 100000, remaining: 140000, label: 'Partiellement payé',
    })
  })
  it('acompte puis solde de 49 000 FCFA : 24 500, puis zéro restant', () => {
    const entries = [{ amount_xof: 24500 }]
    expect(ledgerBalance(49000, entries)).toMatchObject({ collected: 24500, remaining: 24500 })
    entries.push({ amount_xof: 24500 })
    expect(ledgerBalance(49000, entries)).toMatchObject({ collected: 49000, remaining: 0 })
  })
})

describe('documents financiers', () => {
  it('interdit le reçu pour une déclaration non confirmée', async () => {
    const payload = { ...base, kind: 'receipt' as const,
      snapshot: { ...base.snapshot, payment: { ...base.snapshot.payment, status: 'pending' } } }
    await expect(renderFinancePdf(payload)).rejects.toThrow('encaissement confirmé')
  })

  it.each(['receipt', 'instructions'] as const)('génère un PDF A4 valide : %s', async kind => {
    const payload: FinancePdfPayload = { ...base, kind }
    const bytes = await renderFinancePdf(payload)
    const document = await PDFDocument.load(bytes)
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(document.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 })
    if (process.env.CORTEXIA_PDF_QA === '1') {
      const { mkdir, writeFile } = await import('node:fs/promises')
      const path = await import('node:path')
      const directory = path.resolve('output/pdf')
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, kind === 'receipt' ? 'cortexia-recu-controle.pdf' : 'cortexia-instructions-controle.pdf'), bytes)
    }
  })
  it('reproduit exactement le PDF lors d’une reprise idempotente', async () => {
    const payload: FinancePdfPayload = { ...base, kind: 'receipt' }
    const first = await renderFinancePdf(payload)
    const retry = await renderFinancePdf(payload)
    expect(retry).toEqual(first)
  })
})
