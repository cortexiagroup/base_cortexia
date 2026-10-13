import { describe, expect, it } from 'vitest'
import { guessMapping, protectExcelText, rowsToLeads, selectImportSheet, sha256, type ParsedWorkbook } from './excel'

describe('correspondance et préparation des imports', () => {
  it('reconnaît les colonnes usuelles même avec accents', () => {
    expect(guessMapping(['Raison sociale', 'Téléphone', 'Ville', 'Nom du décideur'])).toEqual({
      'Raison sociale': 'company_name', 'Téléphone': 'phone', 'Ville': 'city', 'Nom du décideur': 'contact_name',
    })
  })
  it('préserve les cellules vides et refuse une double association', () => {
    const parsed = { headers: ['Entreprise', 'Ville', 'Téléphone'], rows: [['A', null, '+22890112233']] }
    expect(rowsToLeads(parsed, { Entreprise: 'company_name', Ville: 'city', Téléphone: 'phone' })).toEqual([{ company_name: 'A', city: '', phone: '+22890112233' }])
    expect(() => rowsToLeads(parsed, { Entreprise: 'company_name', Ville: 'company_name' })).toThrow('une seule colonne')
  })
  it('ne traite pas la similarité de nom comme preuve dans le navigateur', () => {
    const parsed = { headers: ['Company name'], rows: [['Cortexia SARL'], ['Cortexia']] }
    expect(rowsToLeads(parsed, { 'Company name': 'company_name' })).toHaveLength(2)
  })
})

describe('export sécurisé', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-4+5', '@SUM(1)', '  =IMPORTXML("x")'])('neutralise une formule Excel : %s', value => {
    expect(protectExcelText(value)).toBe(`'${value}`)
  })
  it('laisse les valeurs ordinaires intactes', () => {
    expect(protectExcelText('Entreprise Cortexia')).toBe('Entreprise Cortexia')
  })
})

describe('choix de feuille Excel', () => {
  it('lit les feuilles d’un vrai classeur et ne prépare que la feuille choisie', async () => {
    const { default: writeExcelFile } = await import('write-excel-file/node')
    const { default: readExcelFile } = await import('read-excel-file/node')
    const buffer = await writeExcelFile([
      { sheet: 'Instructions', data: [['Utilisez la feuille Prospects']] },
      { sheet: 'Prospects', data: [['Entreprise', 'Ville'], ['Cortexia', 'Lomé']] },
    ]).toBuffer()
    const sheets = await readExcelFile(buffer)
    const workbook: ParsedWorkbook = { format: 'xlsx', sheets: sheets.map(sheet => ({ name: sheet.sheet, rows: sheet.data as ParsedWorkbook['sheets'][number]['rows'] })) }
    expect(workbook.sheets.map(sheet => sheet.name)).toEqual(['Instructions', 'Prospects'])
    expect(selectImportSheet(workbook, 'Prospects')).toEqual({ headers: ['Entreprise', 'Ville'], rows: [['Cortexia', 'Lomé']] })
    expect(() => selectImportSheet(workbook, 'Instructions')).toThrow('au moins un prospect')
  })

  it('distingue deux feuilles du même fichier sans changer le hash historique de la première', async () => {
    const file = new Blob(['contenu du classeur'])
    const first = await sha256(file)
    const second = await sha256(file, 'Feuille 2')
    expect(first).not.toBe(second)
    expect(second).toBe(await sha256(file, 'Feuille 2'))
  })
})
