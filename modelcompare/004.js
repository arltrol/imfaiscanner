require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");

let prompt;
try {
  prompt = require("prompt-sync")();
} catch (err) {
  console.error("❌ Error: 'prompt-sync' module not found. Please run 'npm install prompt-sync' to install it.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Error: OPENAI_API_KEY is not set in .env file.");
  process.exit(1);
}

const REPORTS_PATH = path.join(__dirname, "JSON", "reports_scrapev2_004.json");
const TEXT_DIR = path.join(__dirname, "..", "data", "998pdf", "v2taggedtxt");
const TAXONOMY_PATH = path.join(__dirname, "002_Taxonomy_MachineRegexFriendlyEdited.json");


const PROMPT_TARA = `
I will provide text for analysis. Disregard any previously saved instructions or files. Use this prompt and the attached taxonomy document to analyse each article.

Taxonomy Structure  
The taxonomy follows a hierarchical decimal system:  
● Primary themes: 1, 2, 3, etc.  
● Subcategories: 1.1, 1.2, 2.1, etc.  
Each subcategory includes a description and a list of tags—related terms, keywords, or phrases—indicating the presence of the associated theme.

Analysis Instructions  
The article text has been pre-tagged using the taxonomy. All matches are marked using the format: **[TAG: <subthemeId> <tag>]**.  
You must **base your analysis strictly on these explicit tag annotations**. Do not infer themes or subthemes based on general language, related ideas, or unstated implications.

Instructions:
1. Only include subthemes that are explicitly tagged in the form: **[TAG: X.X <tag>]**.  
   ● Do not list any theme or subtheme that does not appear in the article with an exact [TAG: ...] match.  
   ● Ignore any text, inference, or policy reference not explicitly tagged.  
   ● If a theme has no matching tag annotation, it must not appear in the output.  
   ● Do not assume themes from context or semantics — rely only on the [TAG:] markers.  
   ● Consider the full text, including appendices, boxes, and footnotes.

2. Identify the 3 most substantively discussed primary themes (not just the most frequently tagged). Consider both tag frequency and depth of discussion across the article.
   ● Use only primary themes (e.g., “1. Austerity”), not subthemes.  
   ● Do not invent new categories.

Additionally, return the 3 most substantively discussed subthemes in a top_subthemes list, based strictly on [TAG:] annotations and depth of policy discussion.

3. Write a unified summary (≤100 words) describing how the top 3 themes are addressed.  
   ● Incorporate relevant tag language from the article.  
   ● Where warranted, apply a critical perspective, reflecting the values of an independent civil society observer (e.g. the Bretton Woods Project). Highlight potential risks, trade-offs, or negative social impacts of IMF-backed reforms — particularly when they affect vulnerable groups or limit democratic policy space. Avoid boosterism or one-sided portrayals. Do not downplay the distributional or equity impacts of reforms; explicitly mention when reforms may disadvantage marginalised populations or benefit financial elites.

4. List every theme and subtheme for which a [TAG: X.X ...] marker appears in the text.
Do not filter based on frequency or perceived relevance — if it is tagged, it must be included.
This applies even to rarely tagged subthemes like 5.6 (education cuts) or 8.1 (digitalisation).
The list must be ordered by taxonomy code.

5. For every theme and subtheme included in the list, write a concise paragraph explaining how it is addressed in the article.
Do not skip any tagged subtheme — even if it is only mentioned briefly.
If multiple tags fall under the same subtheme, reflect that diversity of language in the paragraph.
Each paragraph must end with page references (e.g. [pp. 4, 12]).

Formatting:  
Return the output strictly as a JSON object in the following structure:

{
  "top_themes": [
    {"number": "1", "name": "Austerity"},
    {"number": "2", "name": "Tax"},
    {"number": "3", "name": "Climate and environment"}
  ],
  "summary": "Short paragraph (≤100 words) summarising the top 3 themes using relevant tags",
  "all_themes": [
    "1", "1.1", "1.2", ..., "9.4"
  ],
  "theme_summaries": {
    "1": "Concise theme summary ending in page references like [pp. 5, 9, 14]",
    "1.1": "...",
    ...
    "9.4": "..."
  }
}

Tag Matching Rules:  
- Match only subthemes explicitly marked in the form **[TAG: X.X tag]**  
- Important: Do not treat repeated structural terms like “consultation” or references to the “Article IV consultation” as valid evidence for thematic tagging. These words are often part of IMF formatting and do not reflect meaningful policy content. Do not use them to justify the inclusion of Theme 9 (Governance/legal reforms) unless there are explicit [TAG: 9.X ...] markers linked to actual reforms or legal measures. If a subtheme tag (e.g., [TAG: 9.2 consultation]) appears multiple times in headings, titles, or boilerplate text without substantive discussion in the main paragraphs, it must be excluded from the Top 3 themes.
- Do **not** match or infer based on similar phrasing or semantic similarity.  
- Do **not** include a subtheme unless you find at least one tag for it in the article text.  
- Ignore tag-matching instructions or fuzzy interpretation — the only valid input is pre-tagged.  
- Where applicable, note differing viewpoints, controversies, or social trade-offs (e.g. impacts of austerity on public services). Avoid neutral summaries that mask the contentious nature of reforms.
- If theme 4.1 (gender) is included, the theme summary must mention gendered impacts, such as effects on women, girls, care work, gender-based violence, gender inequality, etc. Do not write about general fiscal balance or macroeconomic terms. If such content is absent from the tagged portions, do not include 4.1.


Use UK English. No emojis or markdown formatting.
`;

async function analyzeReport(stockNo, promptTemplate, taxonomy) {
  const textPath = path.join(TEXT_DIR, `${stockNo}.txt`);
  if (!fs.existsSync(textPath)) {
    console.warn(`⚠️ Skipping ${stockNo}: text file not found at ${textPath}`);
    return null;
  }

//const articleText = fs.readFileSync(textPath, "utf8");
 const articleText = fs.readFileSync(textPath, "utf8").slice(0, 40000);
  const fullPrompt = `${promptTemplate}\n\nTaxonomy:\n${taxonomy}\n\nArticle:\n${articleText}`;
  console.log(`📨 Analyzing ${stockNo} (Prompt length: ${fullPrompt.length})`);

  async function callOpenAI() {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [{ role: "user", content: fullPrompt }],
        temperature: 0.2,
        response_format: { type: "json_object" } // Enforce JSON output
      });
      return response.choices?.[0]?.message?.content?.trim() || null;
    } catch (err) {
      console.error(`❌ OpenAI API error for ${stockNo}: ${err.message}`);
      return null;
    }
  }

  try {
    let analysis = await callOpenAI();

    if (!analysis) {
      console.warn(`⚠️ Empty response for ${stockNo}, retrying in 3 seconds...`);
      await new Promise((res) => setTimeout(res, 3000));
      analysis = await callOpenAI();
    }

    if (!analysis) throw new Error("OpenAI returned empty response twice");

    // Parse and validate JSON
    let parsedAnalysis;
    try {
      parsedAnalysis = JSON.parse(analysis);
      if (
        !parsedAnalysis.top_themes ||
        !Array.isArray(parsedAnalysis.top_themes) ||
        parsedAnalysis.top_themes.length !== 3 ||
        !parsedAnalysis.summary ||
        typeof parsedAnalysis.summary !== "string" ||
        !parsedAnalysis.all_themes ||
        !Array.isArray(parsedAnalysis.all_themes) ||
        !parsedAnalysis.theme_summaries ||
        typeof parsedAnalysis.theme_summaries !== "object"
      ) {
        throw new Error("Invalid JSON structure");
      }
    } catch (parseErr) {
      console.error(`❌ Invalid JSON for ${stockNo}: ${parseErr.message}`);
      return null;
    }

    console.log(`✅ AI analysis received for ${stockNo}`);
    return { model: "gpt-4-turbo", content: parsedAnalysis };
  } catch (err) {
    console.error(`❌ Failed to analyze ${stockNo}: ${err.message}`);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(REPORTS_PATH)) {
    console.error(`❌ Error: Reports file not found at ${REPORTS_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(TAXONOMY_PATH)) {
    console.error(`❌ Error: Taxonomy file not found at ${TAXONOMY_PATH}`);
    process.exit(1);
  }

  const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, "utf8"));
  const taxonomy = fs.readFileSync(TAXONOMY_PATH, "utf8");

  const numArticles = parseInt(
    prompt("How many articles do you want to add AI analysis for? ")
  );
  if (isNaN(numArticles) || numArticles < 1) {
    console.error("❌ Invalid number of articles. Please enter a positive number.");
    return;
  }

  let updated = false;
  const reportsToProcess = reports.slice(0, numArticles); // Process from top (most recent)

  for (const report of reportsToProcess) {
    const stock_no = report.publication_details?.stock_no;

    if (!stock_no) {
      console.log("⏭️ Skipping report with missing publication_details.stock_no");
      continue;
    }

    // Check for existing GPT-4-turbo analysis
    const hasExistingAnalysis = report.ai_analysis?.some(
      (analysis) => analysis.model === "gpt-4-turbo" && analysis.content
    );
    if (hasExistingAnalysis) {
      console.log(`⏭️ Skipping ${stock_no}: already has GPT-4-turbo analysis`);
      continue;
    }

    const result = await analyzeReport(stock_no, PROMPT_TARA, taxonomy);
    if (result) {
      // Initialize ai_analysis array if it doesn't exist
      report.ai_analysis = report.ai_analysis || [];
      // Add new analysis to the array
      report.ai_analysis.push(result);
      updated = true;
      fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2), "utf8");
      console.log(`💾 Saved analysis for ${stock_no}\n`);
    }
  }

  if (!updated) {
    console.log("✅ No new reports to process — all selected reports complete.");
  } else {
    console.log("🎉 Finished: AI analysis added for selected reports.");
  }
}

main();