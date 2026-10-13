import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { renderProposalPdf, type PdfPayload } from '../_shared/proposal-pdf.ts'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Content-Type': 'application/json' }
function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return response(405, { error: 'Méthode non autorisée.' })
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return response(401, { error: 'Session requise.' })
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !secret) return response(503, { error: 'Configuration serveur incomplète.' })
  try {
    const body = await request.json() as { proposal_id?: string }
    if (!body.proposal_id || !/^[0-9a-f-]{36}$/i.test(body.proposal_id)) return response(400, { error: 'Identifiant invalide.' })
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
    const { data: identity, error: identityError } = await userClient.auth.getUser(token)
    if (identityError || !identity.user) return response(401, { error: 'Session non valide.' })
    const { data: payload, error: payloadError } = await userClient.rpc('commercial_issue_payload', { p_id: body.proposal_id })
    if (payloadError || !payload) return response(403, { error: payloadError?.message ?? 'Proposition inaccessible.' })
    if (payload.existing_document) return response(200, { document_id: payload.existing_document.id, already_issued: true })

    const admin = createClient(url, secret, { auth: { persistSession: false } })
    let logo: Uint8Array | undefined
    if (payload.settings?.logo_storage_path) {
      const { data } = await admin.storage.from('cortexia-documents').download(payload.settings.logo_storage_path)
      if (data) logo = new Uint8Array(await data.arrayBuffer())
    }
    const pdf = await renderProposalPdf(payload as PdfPayload, logo)
    const hashBytes = await crypto.subtle.digest('SHA-256', pdf)
    const hash = Array.from(new Uint8Array(hashBytes), value => value.toString(16).padStart(2, '0')).join('')
    const path = `proposals/${body.proposal_id}/v1.pdf`
    const { error: uploadError } = await admin.storage.from('cortexia-documents').upload(path, pdf, {
      contentType: 'application/pdf', upsert: false, cacheControl: '3600',
    })
    let canonicalHash = hash
    if (uploadError) {
      const { data: existing, error: downloadError } = await admin.storage.from('cortexia-documents').download(path)
      if (downloadError || !existing) return response(409, { error: uploadError.message })
      const bytes = new Uint8Array(await existing.arrayBuffer())
      if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) return response(409, { error: 'Fichier officiel invalide.' })
      const existingHash = await crypto.subtle.digest('SHA-256', bytes)
      canonicalHash = Array.from(new Uint8Array(existingHash), value => value.toString(16).padStart(2, '0')).join('')
      if (canonicalHash !== hash) return response(409, { error: 'Un PDF différent existe déjà à ce chemin. Vérifiez le document avant émission.' })
    }
    const { data: documentId, error: finalizeError } = await admin.rpc('commercial_finalize_document', {
      p_proposal_id: body.proposal_id, p_storage_path: path, p_sha256: canonicalHash, p_actor_id: identity.user.id,
    })
    if (finalizeError || !documentId) return response(409, { error: finalizeError?.message ?? 'Document non enregistré.' })
    return response(200, { document_id: documentId, already_issued: false })
  } catch (error) {
    return response(400, { error: error instanceof Error ? error.message : 'Génération impossible.' })
  }
})
