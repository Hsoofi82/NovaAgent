import { assertPublicHttpUrl } from "./core";
import { htmlToPlainText, type WebSearchItem } from "./webSearch";

/** Parse public HTML search results; challenge/error pages correctly produce no results. */
export function parseFallbackResults(html:string,limit=6):WebSearchItem[]{
  const results:WebSearchItem[]=[],seen=new Set<string>();
  const links=/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for(const match of html.matchAll(links)){
    const raw=/href=["']([^"']+)["']/i.exec(match[1])?.[1]?.replace(/&amp;/g,"&");if(!raw)continue;
    try{
      const redirect=new URL(raw,"https://duckduckgo.com");
      const url=assertPublicHttpUrl(redirect.searchParams.get("uddg")??redirect.href);
      if(url.hostname.endsWith("duckduckgo.com")||seen.has(url.href))continue;
      const tail=html.slice((match.index??0)+match[0].length,(match.index??0)+match[0].length+2500);
      const snippet=/<(?:a|div)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(tail)?.[1]??"";
      const title=htmlToPlainText(match[2],200).trim();if(!title)continue;
      results.push({title,link:url.href,snippet:htmlToPlainText(snippet,500)});seen.add(url.href);
      if(results.length>=limit)break;
    }catch{ /* Ignore malformed or non-public results. */ }
  }
  return results;
}
