import numpy as np
import pandas as pd
import streamlit as st
import json

from model.generic_ner import GenericNERProcessor
from model.multiple_review_processor import MultipleReviewProcessor
from scraper.scraper import ProductReviewAmazonComScraper

DEBUG_MODE = True

st.title("Sumit's amazing app that does NER")

st.text("Find countries of origin from reviews on a product page.")

url = st.text_input("Please enter a URL for a product page at https://www.amazon.com:")

st.write("This is the URL you entered, once available:")
st.write(url)

st.write("We will attempt to extract the reviews for this product at that URL.")
scraper = ProductReviewAmazonComScraper(url=url)
collection_of_reviews = scraper.scrape()

model = GenericNERProcessor()
multiple_review_processor = MultipleReviewProcessor(collection_of_reviews=collection_of_reviews, model=model)
geopolitical_entities_to_present = multiple_review_processor.get_geopolitical_entities_sorted_presentable()
st.write("These are the geopolitical entities mentioned in the reviews: \n" + geopolitical_entities_to_present)

if DEBUG_MODE:
    st.write(
        "Here are the actual reviews we got from the first page. This is for your information only. "
        "It is the source of text analyzed to determine the product's country of origin."
    )

    # Do something with the reviews
    st.write(json.dumps(collection_of_reviews))  # Print everything
