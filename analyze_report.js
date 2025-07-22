require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REPORTS_PATH = path.join(__dirname, "data", "reports.json");
const TEXT_DIR = path.join(__dirname, "data", "extracted-txt");
const PROMPT_TEMPLATE_PATH = path.join(__dirname, "Article IV AI analysis.txt");
const TAXONOMY_PATH = path.join(__dirname, "Article IV Scanner Taxonomy.txt");

async function analyzeReport(stockNo, promptTemplate, taxonomy) {
  const textPath = path.join(TEXT_DIR, `${stockNo}.txt`);
  if (!fs.existsSync(textPath)) {
    console.warn(`⚠️ Skipping ${stockNo}: text file not found`);
    return null;
  }

  const articleText = fs.readFileSync(textPath, "utf8").slice(0, 12000);
  const fullPrompt = `${promptTemplate}\n\nTaxonomy:\n${taxonomy}\n\nArticle:\n${articleText}`;
  console.log(`📨 Analyzing ${stockNo} (Prompt length: ${fullPrompt.length})`);

  async function callOpenAI() {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: fullPrompt }],
      temperature: 0.2,
    });
    return response.choices?.[0]?.message?.content?.trim() || null;
  }

  try {
    let analysis = await callOpenAI();

    if (!analysis) {
      console.warn(`⚠️ Empty response for ${stockNo}, retrying in 3 seconds...`);
      await new Promise((res) => setTimeout(res, 3000));
      analysis = await callOpenAI();
    }

    if (!analysis) throw new Error("OpenAI returned empty response twice");

    console.log(`✅ AI analysis received for ${stockNo}`);
    return analysis;
  } catch (err) {
    console.error(`❌ Failed to analyze ${stockNo}: ${err.message}`);
    return null;
  }
}

async function main() {
  const reports = JSON.parse(fs.readFileSync(REPORTS_PATH, "utf8"));
  const promptTemplate = fs.readFileSync(PROMPT_TEMPLATE_PATH, "utf8");
  const taxonomy = fs.readFileSync(TAXONOMY_PATH, "utf8");

  let updated = false;

  for (const report of reports) {
    const { stock_no, ai_analysis } = report;
    const cleanedAnalysis = (ai_analysis || "").trim();

    if (!stock_no) {
      console.log("⏭️ Skipping report with missing stock_no");
      continue;
    }

    if (cleanedAnalysis.length > 0) {
      console.log(`⏭️ Skipping ${stock_no}: already has AI analysis`);
      continue;
    }

    const result = await analyzeReport(stock_no, promptTemplate, taxonomy);
    if (result) {
      report.ai_analysis = result;
      updated = true;
      fs.writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 2), "utf8");
      console.log(`💾 Saved analysis for ${stock_no}\n`);
    }
  }

  if (!updated) {
    console.log("✅ No new reports to process — all complete.");
  } else {
    console.log("🎉 Finished: missing AI reports successfully completed.");
  }
}

main();
