from typing import List

import pandas as pd
import spacy
from spacy import displacy
from collections import Counter
import pprint


class GenericNERProcessor:
    def __init__(self):
        self.nlp = spacy.load('en_core_web_sm')

    def get_sorted_geopolitical_entities_from_document(self, document: str) -> pd.Series:
        document_processed = self._get_document_processed_from_document(document)
        geopolitical_entities_found = self._get_geopolitical_entities_from_document_processed(
            document_processed=document_processed)
        geopolitical_entities_sorted = self._get_geopolitical_entities_sorted_from_found_occurrences(
            geopolitical_entities_found=geopolitical_entities_found)
        return geopolitical_entities_sorted

    def _get_document_processed_from_document(self, document: str):
        return self.nlp(document)

    def _get_geopolitical_entities_from_document_processed(self, document_processed) -> List[str]:
        geopolitical_entities_found = []
        try:
            geopolitical_entities_found = [x.text for x in document_processed.ents if x.label_ == "GPE"]
        except:
            pass
        return geopolitical_entities_found

    def _get_geopolitical_entities_sorted_from_found_occurrences(self, geopolitical_entities_found: List[str]) -> pd.Series:
        geopolitical_entities_sorted = pd.Series(geopolitical_entities_found).value_counts(sort=True, ascending=False)
        return geopolitical_entities_sorted
