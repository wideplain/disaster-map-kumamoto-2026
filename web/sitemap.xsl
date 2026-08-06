<?xml version="1.0" encoding="UTF-8"?>
<!-- sitemap.xml をブラウザで開いたときに人間可読のテーブルとして表示するためのXSLT。
     クローラはこのスタイルシートを無視するため、SEO上の意味は持たない -->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <xsl:output method="html" encoding="UTF-8"/>
  <xsl:template match="/">
    <html lang="ja">
      <head>
        <meta charset="utf-8"/>
        <title>sitemap.xml - 令和8年熊本地震 被害状況マップ</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 24px; color: #222; }
          h1 { font-size: 18px; }
          p.note { color: #666; font-size: 13px; }
          table { border-collapse: collapse; width: 100%; font-size: 13px; }
          th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
          th { background: #f3f3f0; }
          td.num { text-align: right; }
        </style>
      </head>
      <body>
        <h1>sitemap.xml（クローラ向けサイトマップ）</h1>
        <p class="note">これは検索エンジンのクローラに全ページのURLを伝えるためのXMLファイルです。
          ブラウザでは見やすいようにテーブル表示しています（表示用スタイルはクローラには影響しません）。</p>
        <table>
          <tr><th>#</th><th>URL</th><th>最終更新</th><th>hreflang代替</th></tr>
          <xsl:for-each select="sm:urlset/sm:url">
            <tr>
              <td class="num"><xsl:value-of select="position()"/></td>
              <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
              <td><xsl:value-of select="sm:lastmod"/></td>
              <td class="num"><xsl:value-of select="count(xhtml:link)"/></td>
            </tr>
          </xsl:for-each>
        </table>
        <p class="note">URL数: <xsl:value-of select="count(sm:urlset/sm:url)"/></p>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
