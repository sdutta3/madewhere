from typing import List
import pandas as pd

from model.generic_ner import GenericNERProcessor


class MultipleReviewProcessor:
    def __init__(self, collection_of_reviews: List[str], model: GenericNERProcessor):
        self.collection_of_reviews = collection_of_reviews
        self.model = model

    def get_geopolitical_entities_sorted_presentable(self) -> str:
        reviews_combined = self._concatenate_all_reviews()
        geopolitical_entities_sorted = self.model.get_sorted_geopolitical_entities_from_document(reviews_combined)  # pd.Series returned
        return geopolitical_entities_sorted.to_string(dtype=False)

    def _concatenate_all_reviews(self) -> str:
        return " ".join(self.collection_of_reviews)
