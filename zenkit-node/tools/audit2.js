// Strict audit: no childs<N> normalization, plus hash-table childs key comparison.
const fs=require('node:fs');const {walk}=require('../lib/container');
const A=process.argv[2],B=process.argv[3];
const ba=fs.readFileSync(A),bb=fs.readFileSync(B);
const ga=walk(ba),gb=walk(bb);
const ha=ga.next().value,hb=gb.next().value;
const key=(ht)=>ht.entries.filter(Boolean).map(e=>e.key);
const ca=key(ha.hashTable).filter(k=>/^childs\d+$/.test(k)).map(k=>+k.slice(6)).sort((x,y)=>x-y);
const cb=key(hb.hashTable).filter(k=>/^childs\d+$/.test(k)).map(k=>+k.slice(6)).sort((x,y)=>x-y);
console.log('hashTable total keys:',ha.hashTable.count,'vs',hb.hashTable.count);
console.log('childs keys:',ca.length,'vs',cb.length,'identical multiset:',JSON.stringify(ca)===JSON.stringify(cb));
const mis=new Map();const bump=k=>mis.set(k,(mis.get(k)||0)+1);
const cls=ev=>{const p=ev.path;return p.length?p[p.length-1]:'<root>';};
let i=0,kindDiv=0,childsSeq=0;
for(;;){
  const a=ga.next().value,b=gb.next().value;
  if(!a||!b||a.kind==='eos'||b.kind==='eos'){console.log('end',a&&a.kind,b&&b.kind,'offA',a&&a.fileOffset,'offB',b&&b.fileOffset,'exactA',a&&a.exact,'exactB',b&&b.exact);break;}
  if(a.kind!==b.kind){console.log('!!! KIND DIVERGE event',i,a.kind,b.kind);kindDiv++;break;}
  const c=cls(a);
  if(a.kind==='objectBegin'){
    if(a.frame.name!==b.frame.name) bump(`OBJ-NAME ${a.frame.name} -> ${b.frame.name}`);
    if(a.frame.cls!==b.frame.cls) bump(`OBJ-CLASS ${a.frame.cls} -> ${b.frame.cls}`);
    else if(a.frame.version!==b.frame.version) bump(`OBJ-VERSION ${a.frame.cls}: ${a.frame.version} -> ${b.frame.version}`);
    else if(a.frame.index!==b.frame.index) bump(`OBJ-INDEX ${a.frame.cls}`);
  } else if(a.kind==='entry'){
    if(a.entryName!==b.entryName) bump(`ENTRY-NAME ${c} ${a.entryName} -> ${b.entryName}`);
    else if(a.entryType!==b.entryType) bump(`ENTRY-TYPE ${a.entryName}: ${a.entryType} -> ${b.entryType}`);
    else if((a.entryType==='RAW'||a.entryType==='RAW_FLOAT')&&a.payloadSummary!==b.payloadSummary) bump(`RAW-SIZE ${a.entryName}`);
    else if(a.entryType==='INTEGER'&&/^childs\d+$/.test(a.entryName)&&a.payloadSummary!==b.payloadSummary) bump(`CHILDS-VALUE ${a.entryName}`);
    if(/^childs\d+$/.test(a.entryName)) childsSeq++;
  } else if(a.kind==='rawBlob'){
    if(a.payloadSummary!==b.payloadSummary) bump(`RAWBLOB ${a.payloadSummary} -> ${b.payloadSummary}`);
  }
  i++;
}
console.log(`events ${i}, childs entries compared ${childsSeq}, kindDivergences ${kindDiv}`);
console.log('divergence classes:',mis.size);
for(const [k,v] of [...mis].sort((x,y)=>y[1]-x[1]).slice(0,30)) console.log(`  ${v}\t${k}`);
console.log('file sizes:',ba.length,bb.length,'delta',bb.length-ba.length);
