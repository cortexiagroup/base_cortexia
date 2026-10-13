import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { renderFinancePdf, type FinancePdfPayload } from '../_shared/finance-pdf.ts'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Content-Type': 'application/json' }
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return response(405, { error: 'Méthode non autorisée.' })
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return response(401, { error: 'Session requise.' })
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !secret) return response(503, { error: 'Configuration serveur incomplète.' })
  let jobId: string | undefined
  let admin: ReturnType<typeof createClient> | undefined
  try {
    const body = await request.json() as { job_id?: string }
    jobId = body.job_id
    if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId))
      return response(400, { error: 'Identifiant de document invalide.' })
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
    const { data: identity, error: identityError } = await userClient.auth.getUser(token)
    if (identityError || !identity.user) return response(401, { error: 'Session non valide.' })
    const { data: authorized, error: accessError } = await userClient.rpc('finance_job_payload', { p_id: jobId })
    if (accessError || !authorized) return response(403, { error: accessError?.message ?? 'Document inaccessible.' })
    if (authorized.status === 'completed') return response(200, { document_id: authorized.document_id, already_issued: true })
    admin = createClient(url, secret, { auth: { persistSession: false } })
    const { data: claimed, error: claimError } = await admin.rpc('finance_claim_document_job', { p_id: jobId })
    if (claimError || !claimed) return response(409, { error: claimError?.message ?? 'Document indisponible.' })
    if (claimed.status === 'completed') return response(200, { document_id: claimed.document_id, already_issued: true })
    const pdfPayload: FinancePdfPayload = {
      kind: claimed.kind, document_number: claimed.document_number,
      snapshot: claimed.snapshot, created_at: authorized.created_at,
    }
    let logo: Uint8Array | undefined
    const logoPath = (pdfPayload.snapshot.company as Record<string, unknown> | undefined)?.logo_storage_path
    if (logoPath) {
      const { data } = await admin.storage.from('cortexia-documents').download(String(logoPath))
      if (data) logo = new Uint8Array(await data.arrayBuffer())
    }
    const pdf = await renderFinancePdf(pdfPayload, logo)
    const hashBytes = await crypto.subtle.digest('SHA-256', pdf)
    const hash = Array.from(new Uint8Array(hashBytes), value => value.toString(16).padStart(2, '0')).join('')
    const path = `finance/${claimed.kind}/${jobId}.pdf`
    const { error: uploadError } = await admin.storage.from('cortexia-documents').upload(path, pdf, {
      contentType: 'application/pdf', upsert: false, cacheControl: '3600',
    })
    if (uploadError) {
      const { data: existing, error: downloadError } = await admin.storage.from('cortexia-documents').download(path)
      if (downloadError || !existing) throw new Error(uploadError.message)
      const bytes = new Uint8Array(await existing.arrayBuffer())
      const existingHash = await crypto.subtle.digest('SHA-256', bytes)
      const digest = Array.from(new Uint8Array(existingHash), value => value.toString(16).padStart(2, '0')).join('')
      if (digest !== hash) throw new Error('Un fichier différent existe déjà à ce chemin. Vérification manuelle nécessaire.')
    }
    const { data: documentId, error: finalizeError } = await admin.rpc('finance_finalize_document_job', {
      p_id: jobId, p_path: path, p_sha256: hash,
    })
    if (finalizeError || !documentId) throw new Error(finalizeError?.message ?? 'Document non enregistré.')
    return response(200, { document_id: documentId, already_issued: false })
  } catch (error) {
    if (jobId && admin) await admin.rpc('finance_fail_document_job', { p_id: jobId,
      p_error: error instanceof Error ? error.message : 'Erreur de génération' })
    return response(409, { error: error instanceof Error ? error.message : 'Génération impossible.' })
  }
})
