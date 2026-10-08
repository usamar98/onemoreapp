import {readFileSync,writeFileSync} from "node:fs";
const source=readFileSync("src/lib/phase-five-schema.ts","utf8"),tick=String.fromCharCode(96);
const schema=source.slice(source.indexOf(tick)+1,source.indexOf(tick+";"));
const tables=["resume_sessions","developer_tokens","development_captures","action_proposals","attention_states","product_feedback","feedback_updates","product_events"];
const cloud=schema.replace(/\bBLOB\b/g,"BYTEA").replace(new RegExp("\\b("+[...tables,"users","projects"].join("|")+")\\b","g"),"chapter.$1");
const file=readFileSync("cloud/schema.sql","utf8");
if(!file.includes("CREATE TABLE IF NOT EXISTS chapter.resume_sessions"))writeFileSync("cloud/schema.sql",file.replace("revoke all on all tables in schema chapter",cloud+"\n"+tables.map(t=>"alter table chapter."+t+" enable row level security;").join("\n")+"\nrevoke all on all tables in schema chapter"));
