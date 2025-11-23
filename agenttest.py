import requests
from google import genai
import os
from dotenv import load_dotenv
from typing import Dict, List, Optional, Any
import json

load_dotenv()
GOOGLE_API = os.getenv("GEMINI_API_KEY")


class BioinfoAgent:
    def __init__(self):
        self.query_type = None
        self.query = None
        self.collected_data = {}

    def classify_input(self, query: str) -> str:
        query = query.strip().upper()
        if query.startswith("RS"):
            return "snp"
        else:
            return "gene"

    def collect_myvariant(self, query: str, query_type: str) -> Optional[Dict]:
        try:
            type_param = "variant" if query_type == "snp" else "gene"
            fields = "clinvar,dbnsfp,cadd,cosmic,gnomad,dbsnp,hgvs,gene,refseq,ensembl"
            url = f"https://myvariant.info/v1/{type_param}/{query}?fields={fields}&dotfield=true&size=5"
            response = requests.get(url)
            data = response.json()
            return data
        except Exception as e:
            print(f"MyVariant.info error: {e}")
            return None

    def collect_ensembl_gene(self, gene: str) -> Optional[Dict]:

        try:
            url = f"https://rest.ensembl.org/lookup/symbol/homo_sapiens/{gene}"
            headers = {"Content-Type": "application/json"}
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Ensembl gene lookup error: {e}")
            return None

    def collect_ensembl_variants(self, gene_data: Dict) -> Optional[List[Dict]]:
        if not gene_data:
            return None
        try:
            start = gene_data.get("start")
            end = gene_data.get("end")
            seq = gene_data.get("seq_region_name")

            region = f"{seq}:{start}-{end}"
            url = f"https://rest.ensembl.org/overlap/region/homo_sapiens/{region}"
            params = {"feature": "variation"}
            headers = {"Content-Type": "application/json"}

            response = requests.get(url, headers=headers, params=params, timeout=15)
            response.raise_for_status()
            # dont wanna overwhelm - changeable limit
            return response.json()[:10]
        except Exception as e:
            print(f"Ensembl variants error: {e}")
            return None

    def collect_ensembl_vep(self, snp_id: str) -> Optional[List[Dict]]:
        try:
            url = f"https://rest.ensembl.org/vep/homo_sapiens/id/{snp_id}"
            headers = {"Content-Type": "application/json"}
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f"Ensembl VEP error: {e}")
            return None
        
    def collect_clinicaltables(self, snp_id: str) -> Optional[Dict]:
        try:
            url = "https://clinicaltables.nlm.nih.gov/api/snps/v3/search"
            params = {"terms": snp_id}

            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            if len(data) >= 4 and data[3]:
                table = data[3]
                for row in table:
                    if row[0] == snp_id:
                        return {
                            "rsid": row[0],
                            "chromosome": row[1],
                            "position": row[2],
                            "alleles": row[3],
                            "gene": row[4] if len(row) > 4 and row[4] else None
                        }
            return None
        except Exception as e:
            print(f"ClinicalTables error: {e}")
            return None

    #https://www.ncbi.nlm.nih.gov/books/NBK25500/
    def collect_ncbi_gene(self, gene_symbol: str) -> Optional[Dict]:
        try:
            search_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
            #AND Homo sapiens[Organism]
            search_params = {
                "db": "gene",
                "term": f"{gene_symbol}[Gene Name]",
                "retmode": "json",
                "retmax": "1"
            }

            search_response = requests.get(search_url, params=search_params, timeout=10)
            search_response.raise_for_status()
            search_data = search_response.json()

            if "esearchresult" not in search_data or not search_data["esearchresult"].get("idlist"):
                return None

            gene_id = search_data["esearchresult"]["idlist"][0]

            summary_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
            summary_params = {
                "db": "gene",
                "id": gene_id,
                "retmode": "json"
            }

            summary_response = requests.get(summary_url, params=summary_params, timeout=10)
            summary_response.raise_for_status()
            summary_data = summary_response.json()

            if "result" in summary_data and gene_id in summary_data["result"]:
                return summary_data["result"][gene_id]

            return None
        except Exception as e:
            print(f"NCBI Gene error: {e}")
            return None

    def collect_ncbi_snp(self, snp_id: str) -> Optional[Dict]:
        try:
            id = snp_id.lower().replace("rs", "")

            url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
            params = {
                "db": "snp",
                "id": id,
                "retmode": "json"
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            if "result" in data and id in data["result"]:
                return data["result"][id]

            return None
        except Exception as e:
            print(f"ncbi dbSNP error: {e}")
            return None

    #protein func info
    def collect_uniprot(self, gene_symbol: str) -> Optional[Dict]:
        try:
            url = "https://rest.uniprot.org/uniprotkb/search"
            params = {
                "query": f"gene:{gene_symbol} AND organism_id:9606",
                "format": "json",
                "size": "1"
            }

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            if "results" in data and len(data["results"]) > 0:
                return data["results"][0]

            return None
        except Exception as e:
            print(f"uniport error: {e}")
            return None

    def collect_all_data(self, query: str) -> Dict[str, Any]:

        query = query.strip().lower()
        self.query = query
        self.query_type = self.classify_input(query)
        self.collected_data = {
            "query": query,
            "type": self.query_type,
            "sources": {}
        }

        print(f"\ncollecting data for {self.query_type.lower()}: {query}")

        print("query MyVariant")
        myvariant_data = self.collect_myvariant(query, self.query_type)
        if myvariant_data:
            self.collected_data["sources"]["myvariant"] = myvariant_data
            print("myvariant collected")

        #specific snp routes
        if self.query_type == "snp":
            ct_data = self.collect_clinicaltables(query)
            if ct_data:
                self.collected_data["sources"]["clinicaltables"] = ct_data
                print("collected clinical tables")

            vep_data = self.collect_ensembl_vep(query)
            if vep_data:
                self.collected_data["sources"]["ensembl_vep"] = vep_data
                print("vep ensemble collected")

            ncbi_snp = self.collect_ncbi_snp(query)
            if ncbi_snp:
                self.collected_data["sources"]["ncbi_dbsnp"] = ncbi_snp
                print("ncbi snp collected")

        else:  # gene
            ensembl_gene = self.collect_ensembl_gene(query)
            if ensembl_gene:
                self.collected_data["sources"]["ensembl_gene"] = ensembl_gene
                print("ensemble gene collected")

                variants = self.collect_ensembl_variants(ensembl_gene)
                if variants:
                    self.collected_data["sources"]["ensembl_variants"] = {
                        "count": len(variants),
                        "sample": variants[:10]
                    }
                    print(f"ensembl variants {len(variants)} total")

            ncbi_gene = self.collect_ncbi_gene(query)
            if ncbi_gene:
                self.collected_data["sources"]["ncbi_gene"] = ncbi_gene
                print("ncbi gene collectedd")

            uniprot_data = self.collect_uniprot(query)
            if uniprot_data:
                self.collected_data["sources"]["uniprot"] = uniprot_data
                print("uniprot collected")

        print(f"collection complete {len(self.collected_data['sources'])} sources retrieved\n")

        return self.collected_data

    def ai_summary(self, data: Dict[str, Any]) -> str:
        if not GOOGLE_API:
            return "api key issue"

        client = genai.Client(api_key=GOOGLE_API)
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash", 
                contents=f"Summarize the following JSON data of a gene or SNP:{data}"

            )
            return response.text
        except Exception as e:
            return f"error generating summary: {e}"

    def run(self, query: str) -> Dict[str, Any]:

        collected_data = self.collect_all_data(query)

        summary = self.ai_summary(collected_data)

        result = {
            "query": query,
            "type": collected_data["type"],
            "data_sources_used": list(collected_data["sources"].keys()),
            "raw_data": collected_data["sources"],
            "ai_summary": summary
        }

        return result
