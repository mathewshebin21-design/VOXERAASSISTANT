// PR45 hosted isolation acceptance: pinned previews, no paid providers.
// Creates only synthetic accounts and deletes them on completion.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const API = "https://voxera-jerlhsnnc-ai-e399.vercel.app";
const WEB = "https://voxera-flow-qgymfyvhg-ai-e399.vercel.app";
const STAGING = "https://voxera-api-git-staging-ai-e399.vercel.app";
const PROD = "https://voxera-api-two.vercel.app";
const EXPECTED = "2839e460003255edb084daa201a813ef5aa63ea8";
const get = (url, options={}) => fetch(url,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000),...options});
const json = (body) => ({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
export async function accept({api=API,web=WEB,staging=STAGING,production=PROD,sha=EXPECTED,request=get}={}) {
  assert.equal(api,API); assert.equal(web,WEB); assert.equal(sha,EXPECTED);
  const health = await (await request(api+"/healthz")).json();
  assert.equal(health.commit,sha.slice(0,7));
  assert.equal((await request(api+"/readyz")).status,200);
  const webHome = await request(web+"/");
  assert.equal(webHome.status,200);
  const run = Date.now().toString(36);
  const creds={email:`pr45-${run}@acceptance.example`,password:`PR45 ${run} horse battery staple`};
  let token;
  try {
    const signup=await request(web+"/api/session/signup",{...json({...creds,full_name:"PR45 Validation",organization_name:`PR45 ${run}`}),headers:{"content-type":"application/json","x-voxera-csrf":"1"}});
    assert.equal(signup.status,201,`Web signup returned ${signup.status}`);
    const login=await request(api+"/v1/auth/login",json(creds));
    assert.equal(login.status,200,`Isolated API login returned ${login.status}`);
    token=(await login.json()).access_token;
    for(const [name,other] of [["staging",staging],["production",production]]) {
      const response=await request(other+"/v1/auth/login",json(creds));
      assert.equal(response.status,401,`${name} accepted isolated account or returned unexpected status ${response.status}`);
    }
    const orgs=await request(api+"/v1/me/organizations",{headers:{authorization:`Bearer ${token}`}});
    assert.equal(orgs.status,200);
    assert.ok((await orgs.json()).length>0);
  } finally {
    if(token) {
      const del=await request(api+"/v1/me",{method:"DELETE",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({password:creds.password})});
      assert.equal(del.status,204,"Synthetic account cleanup failed");
    }
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  await accept();
  console.log("PR45 isolated hosted acceptance passed; synthetic account removed");
}
