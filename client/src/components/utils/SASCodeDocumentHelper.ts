// Copyright © 2024, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
  ColorThemeKind,
  Position,
  Selection,
  TextDocument,
  authentication,
  window,
} from "vscode";

import axios from "axios";
import { v4 } from "uuid";

import { profileConfig } from "../../commands/profile";
import { SASAuthProvider } from "../../components/AuthProvider";
import { ConnectionType } from "../profile";
import { SASCodeDocumentParameters } from "./SASCodeDocument";
import { getHtmlStyle, isOutputHtmlEnabled } from "./settings";

/**
 * Get the parameters needed to construct a SASCodeDocument from a TextDocument.
 */
export function getCodeDocumentConstructionParameters(
  textDocument: TextDocument,
  addition?: {
    selections?: ReadonlyArray<Selection>;
    preamble?: string;
    postamble?: string;
  },
): SASCodeDocumentParameters {
  // TODO #810 This is a temporary solution to prevent creating an excessive
  // number of result files for viya connections.
  // This todo will be cleaned up with remaining work in #810.
  const uuid = connectionTypeIsNotRest() ? v4() : undefined;
  // Extract the query parameters
  const params = new URL(decodeURIComponent(textDocument.uri.toString()))
    .searchParams;

  let path: string;
  let id: string;

  if (params.has("id")) {
    id = params.get("id");
    if (/^\/compute\/sessions\/\w+(-\w+)+\/files\/~fs~[^/]+$/.test(id)) {
      path = `${id}`.split("/").pop().replace(/~fs~/g, "/");
    } else if (/^\/files\/files\/[\da-f]+(-[\da-f]+)+$/.test(id)) {
      const fname = textDocument.fileName;
      // For Viya files, we need to make an authenticated GET request to get the folder ancestors
      // Since we cannot use 'await' in a synchronous function, we'll make the async call
      // and log the path once we have it, but return a basic path for now

      // Launch an async operation that doesn't block the return
      fetchFolderAncestors(id, textDocument.fileName)
        .then((folderPath) => {
          if (folderPath) {
            console.log("Path constructed from ancestors:", folderPath);
            // Note: We can't use this path directly in the returned object
            // as we're in an async callback
          }
        })
        .catch((error) => {
          console.error("Error fetching folder ancestors:", error);
        });

      // Return basic file name for now
      if (fname) {
        path = fname;
      }
    }
    console.log("id:", id);
    console.log("path:", path);
  }

  return {
    languageId: textDocument.languageId,
    code: textDocument.getText(),
    selectedCode: getSelectedCode(textDocument, addition?.selections),
    uri: textDocument.uri.toString(),
    fileName:
      path ??
      textDocument.fileName ??
      (textDocument.uri?.scheme === "file"
        ? textDocument.uri?.fsPath
        : textDocument.uri.toString()),
    selections: getCodeSelections(addition?.selections, textDocument),
    preamble: addition?.preamble,
    postamble: addition?.postamble,
    htmlStyle: getHtmlStyleValue(),
    outputHtml: isOutputHtmlEnabled(),
    uuid,
  };
}

/**
 * Helper function to asynchronously fetch folder ancestors
 */
async function fetchFolderAncestors(
  id: string,
  fileName: string,
): Promise<string | null> {
  try {
    // Get the current authentication session
    const session = await authentication.getSession(SASAuthProvider.id, [], {
      createIfNone: true,
    });

    if (!session) {
      console.error("No SAS authentication session available");
      return null;
    }

    // Get the active profile to determine the endpoint URL
    const activeProfile = profileConfig.getActiveProfileDetail();
    if (
      !activeProfile ||
      activeProfile.profile.connectionType !== ConnectionType.Rest
    ) {
      console.error("No active REST profile found");
      return null;
    }

    // Create an authenticated axios instance
    const axiosInstance = axios.create({
      baseURL: activeProfile.profile.endpoint,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    // Make the request to get folder ancestors
    console.log(`Fetching folder ancestors for: ${id}`);
    const response = await axiosInstance.get(
      `/folders/ancestors?childUri=${encodeURIComponent(id)}`,
    );

    if (
      response.data &&
      response.data.items &&
      response.data.items.length > 0
    ) {
      // Process the response to build the file path
      const pathElements = response.data.items.map((item) => item.name);
      // Reverse to get path from root to leaf (ancestors are returned from leaf to root)
      pathElements.reverse();

      // Get the filename either from the response or from the URI
      let filename = "";
      if (fileName) {
        filename = fileName.split("/").pop() || "";
      } else {
        // Try to extract the filename from the response metadata
        try {
          const fileInfoResponse = await axiosInstance.get(
            `/files/files/${id.split("/").pop()}`,
          );
          if (fileInfoResponse.data && fileInfoResponse.data.name) {
            filename = fileInfoResponse.data.name;
          }
        } catch (fileInfoError) {
          console.error("Error fetching file info:", fileInfoError);
        }
      }

      // Add the filename at the end if we have one
      if (filename) {
        pathElements.push(filename);
      }

      // Combine to create the full path
      return "/" + pathElements.join("/");
    } else {
      console.log("No ancestor items found in the response:", response.data);
      return null;
    }
  } catch (error) {
    console.error("Error fetching folder ancestors:", error);
    console.error("Error details:", error.response?.data || error.message);
    return null;
  }
}

/**
 * Get the selected code from a TextDocument.
 */
function getSelectedCode(
  textDocument: TextDocument,
  selections?: ReadonlyArray<Selection>,
): string {
  if (selectionsAreNotEmpty(selections)) {
    return selections
      .map((selection) => {
        return textDocument.getText(selection);
      })
      .join("\n");
  } else {
    return "";
  }
}

/**
 * Check if the active profile is not a REST connection.
 */
function connectionTypeIsNotRest(): boolean {
  const activeProfile = profileConfig.getActiveProfileDetail();
  return (
    activeProfile &&
    activeProfile.profile.connectionType !== ConnectionType.Rest
  );
}

/**
 * Check if any selections are not empty.
 */
function selectionsAreNotEmpty(
  selections: ReadonlyArray<Selection> | undefined,
): boolean {
  return (
    selections?.length > 1 ||
    // the single cursor (if it is not in a selection) is always treated as a selection in Monaco Editor
    (selections?.length === 1 && !selections[0].isEmpty)
  );
}

/**
 * Get the HTML style value based on settings and the current color theme.
 */
function getHtmlStyleValue(): string {
  const htmlStyleSetting = getHtmlStyle();

  switch (htmlStyleSetting) {
    case "(auto)":
      switch (window.activeColorTheme.kind) {
        case ColorThemeKind.Light:
          return "Illuminate";
        case ColorThemeKind.Dark:
          return "Ignite";
        case ColorThemeKind.HighContrast:
          return "HighContrast";
        case ColorThemeKind.HighContrastLight:
          return "Illuminate";
        default:
          return "";
      }
    case "(server default)":
      return "";
    default:
      return htmlStyleSetting;
  }
}

/**
 * If no valid selection, return whole text as only selection.
 */
function getCodeSelections(
  selections: ReadonlyArray<Selection>,
  textDocument: TextDocument,
): ReadonlyArray<Selection> | undefined {
  if (selectionsAreNotEmpty(selections)) {
    const codeSelections: Selection[] = selections.filter(
      (selection) => !selection.isEmpty,
    );
    return codeSelections;
  } else {
    const lastLine = textDocument.lineCount - 1;
    const lastCharacter = textDocument.lineAt(lastLine).text.length;
    return [
      new Selection(new Position(0, 0), new Position(lastLine, lastCharacter)),
    ];
  }
}
