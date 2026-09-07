/** A memory-only snapshot scoped to one member/day. In-flight reads are deduplicated;
 * invalidation stops an older response repopulating the cache after a mutation. */
export function createBoardCache<T>(ttl=30_000,now=()=>Date.now()){
  let scope="",generation=0;
  let snapshot:{value:T;at:number}|null=null;
  let pending:Promise<T>|null=null;
  const select=(key:string)=>{
    if(scope!==key){scope=key;generation++;snapshot=null;pending=null}
  };
  return {
    peek(key:string){select(key);return snapshot?.value??null},
    invalidate(key:string){select(key);generation++;snapshot=null;pending=null},
    read(key:string,fetcher:()=>Promise<T>){
      select(key);
      if(snapshot&&now()-snapshot.at<ttl)return Promise.resolve(snapshot.value);
      if(pending)return pending;
      const version=generation;
      const request=fetcher().then(value=>{
        if(version===generation)snapshot={value,at:now()};
        return value;
      }).finally(()=>{if(version===generation)pending=null});
      pending=request;
      return request;
    },
  };
}
