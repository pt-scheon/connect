/* The site has two root layouts with their own styles: public pages (app/(site)) and members' pages (app/(app)).
   Going between them loads the page afresh. */
export const isPublicPage = (path: string) => path === "/" || /^\/(work|people|colleges|c|rules|privacy|terms|cookies)(\/|$)/.test(path);
