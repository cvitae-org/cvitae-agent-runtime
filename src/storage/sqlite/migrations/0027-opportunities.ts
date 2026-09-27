export const opportunities0027 = /* sql */ `
CREATE TABLE opportunities(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
CREATE TABLE opportunity_members(offer_id TEXT PRIMARY KEY REFERENCES offers(id),opportunity_id TEXT NOT NULL REFERENCES opportunities(id) DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX opportunity_members_group ON opportunity_members(opportunity_id);
CREATE TABLE opportunity_aliases(id TEXT PRIMARY KEY,target_id TEXT NOT NULL REFERENCES opportunities(id));
CREATE TABLE opportunity_exclusions(left_id TEXT NOT NULL REFERENCES offers(id),right_id TEXT NOT NULL REFERENCES offers(id),PRIMARY KEY(left_id,right_id));
CREATE TABLE opportunity_decisions(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,left_id TEXT NOT NULL,right_id TEXT NOT NULL,evidence TEXT NOT NULL,rule_version TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE opportunity_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
INSERT INTO opportunity_revision VALUES(1,1);
CREATE TABLE opportunity_dirty(offer_id TEXT PRIMARY KEY REFERENCES offers(id));
CREATE TABLE opportunity_features(offer_id TEXT PRIMARY KEY REFERENCES offers(id),company TEXT NOT NULL,role TEXT NOT NULL,requisition TEXT NOT NULL,ats TEXT NOT NULL,value TEXT NOT NULL);
CREATE INDEX opportunity_features_company_role ON opportunity_features(company,role);
CREATE INDEX opportunity_features_requisition ON opportunity_features(requisition);
CREATE INDEX opportunity_features_ats ON opportunity_features(ats);
INSERT INTO opportunity_members SELECT id,'opp-'||lower(hex(randomblob(16))) FROM offers;
INSERT INTO opportunities SELECT m.opportunity_id,o.first_seen_at FROM opportunity_members m JOIN offers o ON o.id=m.offer_id;
INSERT INTO opportunity_dirty SELECT id FROM offers;
CREATE TRIGGER opportunity_offer_insert AFTER INSERT ON offers BEGIN
 INSERT INTO opportunity_members VALUES(new.id,'opp-'||lower(hex(randomblob(16))));
 INSERT INTO opportunities SELECT opportunity_id,new.first_seen_at FROM opportunity_members WHERE offer_id=new.id;
 INSERT INTO opportunity_dirty SELECT new.id WHERE NOT EXISTS(SELECT 1 FROM opportunity_dirty WHERE offer_id=new.id);
 UPDATE opportunity_revision SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER opportunity_offer_update AFTER UPDATE OF stated,text,board ON offers
WHEN old.stated IS NOT new.stated OR old.text IS NOT new.text OR old.board IS NOT new.board BEGIN
 INSERT INTO opportunity_dirty SELECT new.id WHERE NOT EXISTS(SELECT 1 FROM opportunity_dirty WHERE offer_id=new.id);
END;
CREATE TRIGGER opportunity_source_insert AFTER INSERT ON discovery_sources BEGIN
 INSERT INTO opportunity_dirty SELECT new.offer_id WHERE NOT EXISTS(SELECT 1 FROM opportunity_dirty WHERE offer_id=new.offer_id);
END;
CREATE TRIGGER opportunity_source_update AFTER UPDATE OF listing ON discovery_sources BEGIN
 INSERT INTO opportunity_dirty SELECT new.offer_id WHERE NOT EXISTS(SELECT 1 FROM opportunity_dirty WHERE offer_id=new.offer_id);
END;
`;
