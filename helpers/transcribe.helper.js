// transcribe.helper.js

const OpenAI = require("openai");
const fs = require("fs");

const client = new OpenAI({
    apiKey: process.env.GPT_4O_MINI_TRANSCRIBLE_KEY
});

async function transcreverAudio(path){

    const resposta = await client.audio.transcriptions.create({
        model: "gpt-4o-mini-transcribe",
        file: fs.createReadStream(path),
        prompt: `
        Transcreva o áudio em português brasileiro seguindo estas regras:
        - Se a pessoa falar uma data, escreva no formato dd/mm/aaaa sempre que possível.
          Exemplo: "vinte e cinco de dezembro de dois mil e vinte e cinco" -> 25/12/2025.
          Exemplo2: "25 de dezembro de 2025" -> 25/12/2025.
          Exemplo3: "25 do 12 de 2025" -> 25/12/2025.
        - Se a pessoa falar apenas dia e mês, escreva dd/mm.
          Exemplo: "vinte e cinco de dezembro" -> 25/12.
        - Se a pessoa falar números, escreva utilizando algarismos, nunca por extenso.
          Exemplo: "um" -> 1, "dois" -> 2, "três" -> 3, "quatro" -> 4, "cinco" -> 5, "seis" -> 6, "sete" -> 7, "oito" -> 8, "nove" -> 9, "dez" -> 10, "cem" -> 100, "mil" -> 1000.
          Cuidado com o número "um", ele pode soar como onomatopeias, como "hum", "humm", "hnm", "hmn" ou "un" caso você entenda algo proximo de "um" ou "hum" considere 1. Quando a pessoa falar um número não digite com ponto no final, apenas o número em algarismos.
        - Preserve o restante do texto exatamente como foi falado.
        `
    });

    return resposta.text;

}

module.exports = {
    transcreverAudio
};