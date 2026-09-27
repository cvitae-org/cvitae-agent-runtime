// The catalogue index is mutable. Chat indexes immutable public evidence instead.
export const discoveryEvidenceIndex0021 = /* sql */ `
CREATE VIRTUAL TABLE discovery_evidence_fts USING fts5(evidence_id UNINDEXED, body);
INSERT INTO discovery_evidence_fts(evidence_id,body) SELECT id,coalesce(json_extract(value,'$.offer.position'),'') || ' ' || coalesce(json_extract(value,'$.offer.company'),'') || ' ' || coalesce(json_extract(value,'$.offer.location'),'') || ' ' || coalesce(json_extract(value,'$.offer.text'),'') || ' ' || coalesce(json_extract(value,'$.offer.skills'),'') || ' ' || coalesce(json_extract(value,'$.offer.analysis.role_profile'),'') || ' ' || coalesce(json_extract(value,'$.offer.analysis.required_skills'),'') || ' ' || coalesce(json_extract(value,'$.listing.title'),'') || ' ' || coalesce(json_extract(value,'$.listing.required_skills'),'') FROM discovery_offer_evidence;
CREATE TRIGGER discovery_evidence_fts_insert AFTER INSERT ON discovery_offer_evidence
BEGIN INSERT INTO discovery_evidence_fts(evidence_id,body) VALUES(new.id,coalesce(json_extract(new.value,'$.offer.position'),'') || ' ' || coalesce(json_extract(new.value,'$.offer.company'),'') || ' ' || coalesce(json_extract(new.value,'$.offer.location'),'') || ' ' || coalesce(json_extract(new.value,'$.offer.text'),'') || ' ' || coalesce(json_extract(new.value,'$.offer.skills'),'') || ' ' || coalesce(json_extract(new.value,'$.offer.analysis.role_profile'),'') || ' ' || coalesce(json_extract(new.value,'$.offer.analysis.required_skills'),'') || ' ' || coalesce(json_extract(new.value,'$.listing.title'),'') || ' ' || coalesce(json_extract(new.value,'$.listing.required_skills'),'')); END;
CREATE TRIGGER discovery_evidence_fts_delete AFTER DELETE ON discovery_offer_evidence
BEGIN DELETE FROM discovery_evidence_fts WHERE evidence_id=old.id; END;
CREATE INDEX discovery_turn_order ON discovery_turn_members(run_id,ordinal);
`;
