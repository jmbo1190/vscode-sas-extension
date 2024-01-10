// Copyright © 2022, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { DocumentSemanticTokensProvider, SemanticTokensBuilder } from "vscode";

let data: string[] = [];

export const legend = {
  tokenTypes: ["error", "warning", "note"],
  tokenModifiers: [],
};

export const LogTokensProvider: DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens: (document) => {
    if (document.getText() === "") {
      data = [];
    }
    const tokensBuilder = new SemanticTokensBuilder(legend);
    const lineTypeRegEx = /^(ERROR|WARNING|NOTE|\S+|\s*$)/;
    let lineType = "";
    let textLine, prevLine1, prevLine1Num, prevLine2, prevLine2Num;
    for (let i = 0; i < data.length; i++) {
      try {
        textLine = document.lineAt(i).text;
        let matches = textLine.match(lineTypeRegEx);
        if (matches && matches.length > 0) {
          lineType = (matches[0] || "").toLowerCase();
          matches = textLine.match(/^ERROR (\d+)-\d+:/);
          if (matches && matches.length > 1 && i > 1) {
            console.log("prevLine1:", prevLine1, "\nprevLine2:", prevLine2);
            if (
              prevLine1 &&
              prevLine2 &&
              (new RegExp("^\\s+" + matches[1] + "$").test(prevLine1) ||
                (new RegExp("^\\s+" + matches[1] + "$").test(prevLine2) &&
                  /^\\s+\\d+$/.test(prevLine1)))
            ) {
              tokensBuilder.push(document.lineAt(prevLine1Num).range, lineType);
              tokensBuilder.push(document.lineAt(prevLine2Num).range, lineType);
            }
          }
        }
        if (lineType && legend.tokenTypes.includes(lineType)) {
          if (lineType === "error") {
            console.log("line:", i, "match:", lineType, "textLine:", textLine);
          }
          if (
            lineType === "note" &&
            /(The SAS System stopped processing this step|SAS set option OBS=0|Variable \w+ is uninitialized.|Missing values were generated|Invalid|Groups are not created|MERGE statement has more than one data set with repeats of BY values|W\.D format was too small|The log axis cannot support zero or negative values|The meaning of an identifier after a quoted string\b|\w+ values have been converted| \w+ was not found or could not be loaded.|The macro \w+ completed compilation with errors\.)/.test(
              textLine,
            )
          ) {
            tokensBuilder.push(document.lineAt(i).range, "warning");
          } else {
            tokensBuilder.push(document.lineAt(i).range, lineType);
          }
        }
        if (legend.tokenTypes.includes(data[i])) {
          tokensBuilder.push(document.lineAt(i).range, data[i]);
        }
      } catch (error) {
        console.log("(provideDocumentSemanticTokens)", error);
      } finally {
        if (!["warning", "note"].includes(lineType)) {
          prevLine2 = prevLine1;
          prevLine2Num = prevLine1Num;
          prevLine1 = textLine;
          prevLine1Num = i;
        }
      }
    }
    return tokensBuilder.build();
  },
};

export const appendLog = (type: string): void => {
  data.push(type);
};
