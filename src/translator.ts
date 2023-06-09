import axios from "axios";
import { chunk } from "lodash";
import * as path from "path";
import * as fs from "fs";

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

interface AssDialog {
    attributes: string;
    dialogText: string;
}

const readAssFile = (filePath: string): [string, AssDialog[]] => {
    const content = fs.readFileSync(filePath).toString();
    if (!content.includes("[Events]")) {
        throw new Error("Invalid ASS: Events block not found.");
    }
    const [header, body] = content.split("[Events]");
    const lines = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => !!line);
    const dialogAttributesDefinition = lines[0];
    const dialogAttributesCount =
        dialogAttributesDefinition.split(",").length + 1;
    const result: AssDialog[] = [];
    for (const line of lines.slice(1)) {
        const splittedLine = line.split(",");
        const attributes = splittedLine
            .slice(0, dialogAttributesCount - 2)
            .join(",");
        const dialogText = splittedLine
            .slice(dialogAttributesCount - 2)
            .join(",");
        result.push({
            attributes,
            dialogText,
        });
    }
    return [`${header}\n[Events]\n`, result];
};

const translate = async (
    originDialogs: AssDialog[],
    apiKey
): Promise<AssDialog[]> => {
    const api = `https://api.openai.com/v1/chat/completions`;
    const prompt =
        "Traduzca los siguientes subtítulos al chino simplificado, mantenga las etiquetas de efectos especiales de los subtítulos originales en la posición correspondiente del resultado y solo traduzca el contenido al chino simplificado. Las etiquetas de efectos especiales se caracterizan por envolverlas entre llaves {}. Sus resultados contienen solo resultados traducidos. Aquí están los subtítulos originales:";
    const attributeArr = originDialogs.map((dialog) => dialog.attributes);
    const dialogTextArr = originDialogs.map((dialog) => dialog.dialogText);
    const response = await axios.post(
        api,
        {
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "user",
                    content: `${prompt}${dialogTextArr.join("\n")}`,
                },
            ],
        },
        {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
        }
    );
    const result = response.data?.choices?.[0]?.message?.content;
    if (!result) {
        throw new Error("Invalid response");
    }
    const resultLines = result
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => !!line);
    const translatedDialogs: AssDialog[] = [];
    for (let i = 0; i <= originDialogs.length - 1; i++) {
        if (!resultLines[i]) {
            continue;
        }
        translatedDialogs.push({
            attributes: attributeArr[i],
            dialogText: resultLines[i],
        });
    }
    console.log(translatedDialogs);
    return translatedDialogs;
};

interface TranslatorOptions {
    openaiApiKey: string;
    disableRateLimit?: boolean;
    batchSize?: number;
}

export default class Translator {
    apiKey = "";

    disableRateLimit = false;

    batchSize = 10;

    result = [];

    constructor({
        openaiApiKey,
        disableRateLimit = false,
        batchSize = 10,
    }: TranslatorOptions) {
        this.apiKey = openaiApiKey;
        this.disableRateLimit = disableRateLimit;
        this.batchSize = batchSize;
    }

    translate = async (file: string) => {
        const [header, dialogs] = readAssFile(file);
        const chunks = chunk<AssDialog>(dialogs, this.batchSize);
        let retries = 5;
        for (let i = 0; i <= chunks.length - 1; i++) {
            let translatedDialogs: AssDialog[];
            while (retries > 0) {
                try {
                    translatedDialogs = await translate(chunks[i], this.apiKey);
                    break;
                } catch (e) {
                    retries -= 1;
                    console.log(`Get translation failed, retry ${5 - retries}`);
                }
            }
            if (!translatedDialogs) {
                throw new Error("Cannot get translation from OpenAI.");
            }
            if (!this.disableRateLimit) {
                await sleep(5000); // API Rate limit
            }
            this.result.push(
                ...translatedDialogs.map(
                    (dialog) => `${dialog.attributes},${dialog.dialogText}`
                )
            );
            console.log(`Finished ${i + 1} / ${chunks.length}`);
        }
    };
}
