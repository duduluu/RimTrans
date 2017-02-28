﻿using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Text;
using System.Threading.Tasks;
using System.Xml;
using System.Xml.Linq;
using RimTrans.Builder.Xml;

namespace RimTrans.Builder
{
    public class KeyedData
    {
        private SortedDictionary<string, XDocument> _data;
        public SortedDictionary<string, XDocument> Data { get { return this._data; } }

        private KeyedData()
        {

        }

        public KeyedData(KeyedData other)
        {
            this._data = new SortedDictionary<string, XDocument>();
            foreach (KeyValuePair<string, XDocument> fileNameDocPairOther in other._data)
            {
                this._data.Add(fileNameDocPairOther.Key, new XDocument(fileNameDocPairOther.Value));
            }
        }

        #region Load

        public static KeyedData Load(string path)
        {
            KeyedData keyedData = new KeyedData();
            keyedData._data = new SortedDictionary<string, XDocument>();

            DirectoryInfo dirInfo = new DirectoryInfo(path);
            if (dirInfo.Exists)
            {
                Log.Info();
                Log.Write("Loading Keyed: ");
                Log.WriteLine(ConsoleColor.Cyan, path);
                int countValidFiles = 0;
                int countInvalidFiles = 0;
                int splitIndex = dirInfo.FullName.Length + 1;
                foreach (FileInfo fileInfo in dirInfo.GetFiles("*.xml", SearchOption.AllDirectories))
                {
                    XDocument doc = null;
                    string filePath = fileInfo.FullName;
                    try
                    {
                        doc = DocHelper.LoadLanguageDoc(filePath);
                        countValidFiles++;
                    }
                    catch (XmlException ex)
                    {
                        Log.Error();
                        Log.WriteLine(ex.Message);
                        Log.Indent();
                        Log.WriteLine(filePath);
                        countInvalidFiles++;
                    }
                    if (doc != null)
                    {
                        keyedData._data.Add(filePath.Substring(splitIndex), doc);
                    }
                }
                if (countValidFiles > 0)
                {
                    if (countInvalidFiles == 0)
                    {
                        Log.Info();
                        Log.WriteLine("Completed Loading Keyed: {0} file(s).", countValidFiles);
                    }
                    else
                    {
                        Log.Warning();
                        Log.WriteLine("Completed Loading Keyed: Success: {0} file(s), Failure: {1} file(s).", countValidFiles, countInvalidFiles);
                    }
                }
                else
                {
                    if (countInvalidFiles == 0)
                    {
                        Log.Info();
                        Log.WriteLine("Directory \"Keyed\" is empty.");
                    }
                    else
                    {
                        Log.Error();
                        Log.WriteLine("Loading failed: {1} file(s).", countInvalidFiles);
                    }
                }
            }
            else
            {
                Log.Info();
                Log.Write("Directory \"Keyed\" does not exist: ");
                Log.WriteLine(ConsoleColor.Cyan, path);
            }
            return keyedData;
        }

        #endregion

        #region Match

        public void MatchExisted(KeyedData keyedDataExisted)
        {
            if (keyedDataExisted._data.Count == 0) return;

            Log.Info();
            Log.WriteLine("Start matching existed Keyed.");
            int countInvalidFiles = 0;
            int countMatched = 0;
            IEnumerable<XElement> keyeds = from doc in this._data.Values
                                           from ele in doc.Root.Elements()
                                           select ele;
            IEnumerable<XElement> keyedsExisted = from doc in keyedDataExisted._data.Values
                                                  from ele in doc.Root.Elements()
                                                  select ele;
            foreach (XElement keyed in keyeds)
            {
                foreach (XElement keyedExisted in keyedsExisted)
                {
                    if (keyed.Name == keyedExisted.Name)
                    {
                        keyed.Value = keyedExisted.Value;
                        countMatched++;
                    }
                }
            }
            foreach (KeyValuePair<string, XDocument> fileNameDocPairExisted in keyedDataExisted._data)
            {
                string fileName = fileNameDocPairExisted.Key;
                XDocument docExisted = fileNameDocPairExisted.Value;
                XDocument doc;
                if (this._data.TryGetValue(fileName, out doc))
                {
                    XElement rootExisted = docExisted.Root;
                    XElement root = doc.Root;
                    bool hasInvalidNodes = false;
                    foreach (XNode nodeExited in rootExisted.Nodes())
                    {
                        if (nodeExited.NodeType == XmlNodeType.Comment)
                        {
                            bool isMatched = false;
                            foreach (XNode node in root.Nodes())
                            {
                                if (node.NodeType == XmlNodeType.Comment &&
                                    ((XComment)nodeExited).Value == ((XComment)node).Value)
                                {
                                    isMatched = true;
                                    break;
                                }
                            }
                            if (!isMatched)
                            {
                                root.Add("  ", nodeExited, "\n");
                                hasInvalidNodes = true;
                            }
                        }
                        else if (nodeExited.NodeType == XmlNodeType.Element)
                        {
                            bool isMatched = false;
                            foreach (XNode node in root.Nodes())
                            {
                                if (node.NodeType == XmlNodeType.Element &&
                                    ((XElement)nodeExited).Name == ((XElement)node).Name)
                                {
                                    isMatched = true;
                                    break;
                                }
                            }
                            if (!isMatched)
                            {
                                root.Add("  ", new XComment(nodeExited.ToString()), "\n");
                                hasInvalidNodes = true;
                            }
                        }
                    }
                    if (hasInvalidNodes) root.Add("\n");
                }
            }
            Log.Info();
            Log.WriteLine("Completed matching existed Keyed: {0} matched node(s), {1} invalid file(s).", countMatched, countInvalidFiles);
        }

        #endregion

        #region Save

        public void Save(string path)
        {
            if (this._data.Count == 0) return;

            Log.Info();
            Log.Write("Start outputing Keyed: ");
            Log.WriteLine(ConsoleColor.Cyan, path);
            DirectorySecurity ds = new DirectorySecurity(path, AccessControlSections.Access);
            if (ds.AreAccessRulesProtected)
            {
                Log.Error();
                Log.WriteLine("Outputing Keyed failed: No write permission to directory.");
                Log.Indent();
                Log.WriteLine(ConsoleColor.Red, path);
                return;
            }

            int countValidFiles = 0;
            int countInvalidFiles = 0;
            int countValidNodes = 0;
            int countInvalidNodes = 0;
            foreach (KeyValuePair<string, XDocument> fileNameDocPair in this._data)
            {
                string filePath = Path.Combine(path, fileNameDocPair.Key);
                XDocument doc = fileNameDocPair.Value;
                XElement root = doc.Root;
                string dirPath = path;
                if (Path.GetFileName(filePath) != fileNameDocPair.Key)
                {
                    dirPath = Path.GetDirectoryName(filePath);
                    if (Directory.Exists(dirPath))
                    {
                        DirectorySecurity curDs = new DirectorySecurity(dirPath, AccessControlSections.Access);
                        if (curDs.AreAccessRulesProtected)
                        {
                            Log.Error();
                            Log.WriteLine("Creating subdirectory failed: No write permission to directory.");
                            Log.Indent();
                            Log.WriteLine(ConsoleColor.Red, dirPath);
                            countInvalidFiles++;
                            countInvalidNodes += root.Elements().Count();
                            continue;
                        }
                    }
                    else
                    {
                        Directory.CreateDirectory(dirPath);
                    }
                }
                string text = root.ToString();
                if (text.IndexOf("-&gt;") > 0)
                {
                    try
                    {
                        using (StreamWriter sw = new StreamWriter(filePath))
                        {
                            sw.WriteLine(doc.Declaration.ToString());
                            sw.Write(text.Replace("-&gt;", "->"));
                        }
                        countValidFiles++;
                        countValidNodes += root.Elements().Count();
                    }
                    catch (Exception ex)
                    {
                    }
                }
                else
                {
                    try
                    {
                        doc.Save(filePath);
                        countValidFiles++;
                        countValidNodes += root.Elements().Count();
                    }
                    catch (Exception ex)
                    {
                        Log.Error();
                        Log.Write("Outputing file failed: ");
                        Log.WriteLine(ConsoleColor.Red, filePath);
                        Log.Indent();
                        Log.WriteLine(ex.Message);
                        countInvalidFiles++;
                        countInvalidNodes += root.Elements().Count();
                    }
                }
            }
            if (countValidFiles > 0)
            {
                if (countInvalidFiles == 0)
                {
                    Log.Info();
                    Log.WriteLine("Completed outputing Keyed: {0} file(s), {1} nodes.", countValidFiles, countValidNodes);
                }
                else
                {
                    Log.Warning();
                    Log.WriteLine("Completed outputing Keyed: Success: {0} file(s), {1} node(s); Failure {1} file(s), {3} node(s).",
                        countValidFiles, countValidNodes, countInvalidFiles, countInvalidNodes);
                }
            }
            else
            {
                if (countInvalidFiles == 0)
                {
                    Log.Info();
                    Log.WriteLine("No Keyed to be output.");
                }
                else
                {
                    Log.Error();
                    Log.WriteLine("Outputing Keyed failed: {0} file(s), {1} nodes.", countInvalidFiles, countInvalidNodes);
                }
            }
        }

        #endregion

        #region Debug

        public void Debug(string fileName)
        {
            XDocument doc;
            if (this._data.TryGetValue(fileName, out doc))
            {
                Log.Write(ConsoleColor.Cyan, fileName);
                Log.WriteLine(doc.ToString());
            }
        }

        public void Debug()
        {

            Log.WriteLine(ConsoleColor.Cyan, "KeyedData.Debug()");
            foreach (var fileNameDocPair in this._data)
            {
                Log.WriteLine(fileNameDocPair.Key);
            }
        }

        #endregion
    }
}